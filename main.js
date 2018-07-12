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
