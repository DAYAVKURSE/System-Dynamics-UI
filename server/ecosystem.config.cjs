// Конфиг PM2 для продакшена (без Docker). Разворачивается CI как есть,
// рядом с server/src — пути указаны относительно этого файла.
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
  ],
};
