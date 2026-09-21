// Конфиг PM2 для продакшена (без Docker). Разворачивается CI как есть,
// рядом с server/src — пути указаны относительно этого файла.
//
// Два приложения: сервер хранилища и сервис кодов (codes/). Сервис кодов —
// без зависимостей и без dotenv, поэтому его переменные берутся из того же
// .env здесь, при запуске: одна настройка на обоих.
const fs = require("node:fs");
const path = require("node:path");

function envFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
  } catch { /* нет .env — значит, и настроек нет */ }
  return out;
}
const env = envFile();

module.exports = {
  apps: [
    {
      name: "system-dynamics-ui",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "system-dynamics-codes",
      script: "codes/src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        CODES_PORT: env.CODES_PORT || "3010",
        CODES_HOST: env.CODES_HOST || "127.0.0.1",
        CODES_DIR: env.CODES_DIR || path.join(__dirname, "data", "codes"),
      },
    },
  ],
};
