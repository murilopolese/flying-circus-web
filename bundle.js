(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const EventEmitter = require('events')
const WebSocketAdapter = require('./websocketadapter.js')

class WebsocketConnection extends EventEmitter {
    constructor() {
        super()
        this.binaryState = 0
        this.sendFileName = ''
        this.sendFileData = new ArrayBuffer()
        this.getFileName = ''
        this.getFileData = new ArrayBuffer()
        this.STOP = '\r\x03' // CTRL-C 2x
        this.RESET = '\r\x04' // CTRL-D
        this.ENTER_RAW_REPL = '\r\x01' // CTRL-A
        this.EXIT_RAW_REPL = '\r\x04\r\x02' // CTRL-D + CTRL-B
    }
    /**
    * List all available WebREPL addresses
    * @return {Promise} Resolves with an array of available WebREPL addresses
    */
    static listAvailable() {
        // TODO: Find a way to list all the possible WebREPL ips on your network
        return Promise.resolve([])
    }
    /**
    * Opens a connection given an ip address and a password.
    * @param {String} ip Ip address without protocols or ports
    * @param {String} password MicroPython's WebREPL password
    */
    open(ip, password) {
        this.ip = ip
        this.password = password
        this.ws = new WebSocketAdapter(`ws://${ip}:8266`)
        this.ws.on('open', () => {
            this.ws.on('message', this._handleMessage.bind(this))
        })
        this.ws.on('close', () => {
            this.emit('disconnected')
        })
    }
    /**
    * Closes current connection.
    */
    close() {
        this.emit('disconnected')
        if (this.ws) {
            this.ws.close()
        }
    }
    /**
    * Executes code in a string format. This code can contain multiple lines.
    * @param {String} code String of code to be executed. Line breaks must be `\n`
    */
    execute(code) {
        let interval = 30
        let page = 80
        let enterRawRepl = () => {
            return new Promise((resolve) => {
                this._enterRawRepl()
                setTimeout(() => {
                    resolve()
                }, interval*2)
            })
        }
        let executeRaw = () => {
            return new Promise((resolve, reject) => {
                let lines = code.split('\n')
                let t = 0
                this.emit('output', `\r\n`)
                for(let i = 0; i < lines.length; i++) {
                    let line = lines[i]
                    if (line.length < page) {
                        t += lines[i].length
                        setTimeout(() => {
                            this.evaluate(line+'\n')
                            this.emit('output', `.`)
                        }, t)
                    } else {
                        for(let j = 0; j < Math.ceil(line.length / page); j++) {
                            t += page
                            setTimeout(() => {
                                this.evaluate(line.substr(j*1024, 1024))
                                this.emit('output', `.`)
                            }, t)
                        }
                    }
                }
                setTimeout(() => {
                    resolve()
                }, t+100)
            })
        }
        let exitRawRepl = () => {
            this._exitRawRepl()
            return Promise.resolve()
        }
        return enterRawRepl()
            .then(executeRaw)
            .then(exitRawRepl)
    }
    /**
    * Evaluate a command/expression.
    * @param {String} command Command/expression to be evaluated
    */
    evaluate(command) {
        this.ws.send(command)
    }
    /**
    * Send a "stop" command in order to interrupt any running code. For serial
    * REPL this command is "CTRL-C".
    */
    stop() {
        this.evaluate(this.STOP)
    }
    /**
    * Send a command to "soft reset".
    */
    softReset() {
        this.stop()
        this.evaluate(this.RESET)
    }
    /**
    * Prints on console the existing files on file system.
    */
    listFiles() {
        const code = `print(' ')
from os import listdir
print(listdir())
`
        this.execute(code)
    }
    /**
    * Prints on console the content of a given file.
    * @param {String} path File's path
    */
    loadFile(path) {
        // WEBREPL_FILE = "<2sBBQLH64s"
        let rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
        rec[0] = 'W'.charCodeAt(0);
        rec[1] = 'A'.charCodeAt(0);
        rec[2] = 2; // get
        rec[3] = 0;
        rec[4] = 0; rec[5] = 0; rec[6] = 0; rec[7] = 0; rec[8] = 0; rec[9] = 0; rec[10] = 0; rec[11] = 0;
        rec[12] = 0; rec[13] = 0; rec[14] = 0; rec[15] = 0;
        rec[16] = path.length & 0xff; rec[17] = (path.length >> 8) & 0xff;
        for (let i = 0; i < 64; ++i) {
            if (i < path.length) {
                rec[18 + i] = path.charCodeAt(i);
            } else {
                rec[18 + i] = 0;
            }
        }

        // initiate get
        this.binaryState = 21;
        this.getFileName = path;
        this.getFileData = new Uint8Array(0);
        this.evaluate(rec);
    }
    /**
    * Writes a given content to a file in the file system.
    * @param {String} path File's path
    * @param {String} content File's content
    */
    writeFile(path, content) {
        // This looks wrong but it will be used later on by `_handleMessage`
        this.sendFileName = path
        let buff = new Uint8Array(content.length)
        for( let i = 0; i < content.length; i++) {
            buff[i] = content.charCodeAt(i);
        }
        this.sendFileData = buff

        let dest_fname = this.sendFileName
        let dest_fsize = this.sendFileData.length

        // WEBREPL_FILE = "<2sBBQLH64s"
        let rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64)
        rec[0] = 'W'.charCodeAt(0)
        rec[1] = 'A'.charCodeAt(0)
        rec[2] = 1 // put
        rec[3] = 0
        rec[4] = 0; rec[5] = 0; rec[6] = 0; rec[7] = 0; rec[8] = 0; rec[9] = 0; rec[10] = 0; rec[11] = 0;
        rec[12] = dest_fsize & 0xff; rec[13] = (dest_fsize >> 8) & 0xff; rec[14] = (dest_fsize >> 16) & 0xff; rec[15] = (dest_fsize >> 24) & 0xff;
        rec[16] = dest_fname.length & 0xff; rec[17] = (dest_fname.length >> 8) & 0xff;
        for (let i = 0; i < 64; ++i) {
            if (i < dest_fname.length) {
                rec[18 + i] = dest_fname.charCodeAt(i)
            } else {
                rec[18 + i] = 0
            }
        }

        // initiate put
        this.binaryState = 11
        this.evaluate(rec)
    }
    /**
    * Removes file on a given path
    * @param {String} path File's path
    */
    removeFile(path) {
        const pCode = `from os import remove
remove('${path}')`
        this.execute(pCode)
    }

    _decodeResp(data) {
        if (data[0] == 'W'.charCodeAt(0) && data[1] == 'B'.charCodeAt(0)) {
            var code = data[2] | (data[3] << 8)
            return code;
        } else {
            return -1;
        }
    }
    _handleMessage(event) {
        if (event.data instanceof ArrayBuffer) {
            let data = new Uint8Array(event.data)
            switch (this.binaryState) {
                case 11:
                    // first response for put
                    if (this._decodeResp(data) == 0) {
                        // send file data in chunks
                        for (let offset = 0; offset < this.sendFileData.length; offset += 1024) {
                            this.ws.send(this.sendFileData.slice(offset, offset + 1024))
                        }
                        this.binaryState = 12
                    }
                    break
                case 12:
                    // final response for put
                    if (this._decodeResp(data) == 0) {
                        console.log(`Sent ${this.sendFileName}, ${this.sendFileData.length} bytes`)
                        this.emit('output', `Sent ${this.sendFileName}, ${this.sendFileData.length} bytes\r\n`)
                    } else {
                        console.log(`Failed sending ${this.sendFileName}`)
                        this.emit('output', `Failed sending ${this.sendFileName}\r\n`)
                    }
                    this.binaryState = 0
                    break;
                case 21:
                    // first response for get
                    if (this._decodeResp(data) == 0) {
                        this.binaryState = 22
                        var rec = new Uint8Array(1)
                        rec[0] = 0
                        this.ws.send(rec)
                    }
                    break;
                case 22: {
                    // file data
                    var sz = data[0] | (data[1] << 8)
                    if (data.length == 2 + sz) {
                        // we assume that the data comes in single chunks
                        if (sz == 0) {
                            // end of file
                            this.binaryState = 23
                        } else {
                            // accumulate incoming data to this.getFileData
                            var new_buf = new Uint8Array(this.getFileData.length + sz)
                            new_buf.set(this.getFileData)
                            new_buf.set(data.slice(2), this.getFileData.length)
                            this.getFileData = new_buf
                            console.log('Getting ' + this.getFileName + ', ' + this.getFileData.length + ' bytes')
                            this.emit('output', 'Getting ' + this.getFileName + ', ' + this.getFileData.length + ' bytes\r\n')

                            var rec = new Uint8Array(1)
                            rec[0] = 0
                            this.ws.send(rec)
                        }
                    } else {
                        this.binaryState = 0
                    }
                    break;
                }
                case 23:
                    // final response
                    if (this._decodeResp(data) == 0) {
                        console.log(`Got ${this.getFileName}, ${this.getFileData.length} bytes`)
                        this.emit('output', `Got ${this.getFileName}, ${this.getFileData.length} bytes\r\n`)
                        this._saveAs(this.getFileName, this.getFileData)
                    } else {
                        console.log(`Failed getting ${this.getFileName}`)
                    }
                    this.binaryState = 0
                    break
                case 31:
                    // first (and last) response for GET_VER
                    console.log('GET_VER', data)
                    this.binaryState = 0
                    break
            }
        }
        // If is asking for password, send password
        if( event.data == 'Password: ' ) {
            this.ws.send(`${this.password}\r`)
            this.emit('connected')
        }
        this.emit('output', event.data)
    }
    _Utf8ArrayToStr(array) {
        var out, i, len, c;
        var char2, char3;

        out = "";
        len = array.length;
        i = 0;
        while(i < len) {
        c = array[i++];
        switch(c >> 4)
        {
          case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
            out += String.fromCharCode(c);
            break;
          case 12: case 13:
            // 110x xxxx   10xx xxxx
            char2 = array[i++];
            out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            break;
          case 14:
            // 1110 xxxx  10xx xxxx  10xx xxxx
            char2 = array[i++];
            char3 = array[i++];
            out += String.fromCharCode(((c & 0x0F) << 12) |
                           ((char2 & 0x3F) << 6) |
                           ((char3 & 0x3F) << 0));
            break;
        }
        }

        return out;
    }
    _saveAs(fileName, data) {
        this.emit('output', this._Utf8ArrayToStr(data))
    }
    _enterRawRepl() {
        this.evaluate(this.ENTER_RAW_REPL)
    }
    _exitRawRepl() {
        this.evaluate(this.EXIT_RAW_REPL)
    }
    _executeRaw(raw) {
        for(let i = 0; i < raw.length; i += 256) {
            setTimeout(() => {
                this.evaluate(raw.substr(i, 256))
                console.log('sent', raw.substr(i, 256))
            }, (1 + i) * 50)
        }
        if (raw.indexOf('\n') == -1) {
            this.evaluate('\r')
        }
    }

}

module.exports = WebsocketConnection

},{"./websocketadapter.js":2,"events":4}],2:[function(require,module,exports){
const EventEmitter = require('events')

class WebSocketAdapter extends EventEmitter {
    constructor(address) {
        super()
        try {
            console.log('Using existing `WebSocket` class')
            // If there is already a `WebSocket` object, it's probably being
            // loaded on browser and the only thing to do is to proxy the
            // HTML5 API to an event based API
            this.ws = new WebSocket(address)
            this.ws.binaryType = 'arraybuffer'
            this.ws.onopen = () => {
                this.emit('open')
            }
            this.ws.onclose = () => {
                this.emit('close')
            }
            this.ws.onmessage = (msg) => {
                this.emit('message', msg)
            }
            this.ws.onerror = (err) => {
                this.emit('error', err)
            }
            // this.ws.connect()
        } catch(error) {
            console.log('Using nodejs `ws` class')
            // If there is no `WebSocket` object, import the nodejs `ws` module
            // and proxy its events to the adapter.
            const WebSocket = require('ws')
            this.ws = new WebSocket(address)
            this.ws.binaryType = 'arraybuffer'
            this.ws.on('open', () => { this.emit('open') })
            this.ws.on('close', () => { this.emit('close') })
            this.ws.on('message', (msg) => { this.emit('message', msg) })
            this.ws.on('error', (error) => { this.emit('error', error) })
        }
    }
    send(msg) {
        this.ws.send(msg)
    }
    close() {
        this.ws.close()
    }
}

module.exports = WebSocketAdapter

},{"events":4,"ws":undefined}],3:[function(require,module,exports){
var WebsocketConnection = require('flying-circus-connection-websocket')

window.onload = () => {
    console.log('loaded')

    let flyingCircus = document.createElement('flying-circus-ide')

    WebsocketConnection.prototype._saveAs = (path, data) => {
        flyingCircus.set('code', new TextDecoder('utf-8').decode(data))
    }

    flyingCircus.WebsocketConnection = WebsocketConnection

    document.body.appendChild(flyingCircus)

}

},{"flying-circus-connection-websocket":1}],4:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}]},{},[3]);
