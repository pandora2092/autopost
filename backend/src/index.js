const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db/client');
const { initSchema } = require('./db/schema');

const proxyRouter = require('./routes/proxy');
const vmRouter = require('./routes/vm');
const profilesRouter = require('./routes/profiles');
const postsRouter = require('./routes/posts');
const systemRouter = require('./routes/system');

const app = express();
const PORT = process.env.PORT || 3000;

initSchema();

const scheduler = require('./services/scheduler');
scheduler.start();
app.set('scrcpyPortBase', parseInt(process.env.SCRCPY_PORT_BASE || '27183', 10));

app.use(cors());
app.use(express.json());

app.use('/api/proxy', proxyRouter);
app.use('/api/vm', vmRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/posts', postsRouter);
app.use('/api/system', systemRouter);

// Статика веб-панели (собранной или статические файлы)
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: 'ok' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
