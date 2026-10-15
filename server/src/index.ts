import http from 'node:http'
import { app } from './app.js'
import { attachTerminal } from './terminal.js'

const port = Number(process.env.PORT ?? 3000)
// A plain http server so the developer terminal's WebSocket upgrade can attach beside Express.
const server = http.createServer(app)
attachTerminal(server)
server.listen(port, '0.0.0.0', () => {
  console.log(`xGallery server listening on :${port}`)
})
