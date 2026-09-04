import express from 'express';
import { PORT } from './config.js';
import authRouter from './routes/auth.js';
import modelsRouter from './routes/models.js';

let app = express();
app.use(express.static('wwwroot'));
app.use('/collision', express.static('collision'));
app.use(authRouter);
app.use(modelsRouter);
app.listen(PORT, function () { console.log(`Server listening on port ${PORT}...`); });
