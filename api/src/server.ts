import { buildApp } from './app.js';
import { config } from './config.js';

buildApp().listen(config.PORT, () => {
  console.log(`QuickKart API listening on http://localhost:${config.PORT}`);
});
