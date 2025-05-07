import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const db = await open({
  filename: 'chat.db',
  driver: sqlite3.Database
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT NOT NULL,
      moniker TEXT NOT NULL
  );
`);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
  socket.on('chat message', async (msg, clientOffset, mnk, callback) => {
    let result;
    try {
      result = await db.run('INSERT INTO messages (moniker, content, client_offset, callback) VALUES (?, ?, ?)', mnk, msg, clientOffset);
    } catch (e) {
      if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
        callback();
      } else {
        // nothing to do, just let the client retry
      }
      return;
    }
    io.emit('chat message', msg, result.lastID, mnk);
    callback();
  });

  if (!socket.recovered) {
    try {
      await db.each('SELECT id, content, moniker FROM messages WHERE id > ?',
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit('chat message', row.content, row.id, row.moniker, row.client_offset);
        }
      )
    } catch (e) {
      // something went wrong
    }
  }
});

server.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});

