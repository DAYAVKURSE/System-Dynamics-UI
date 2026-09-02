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
    {
      // Воркер моста к Claude Code — на этом же сервере: у владельца нет
      // своей машины. Читает тот же .env, что и сервер, поэтому общий секрет
      // ему не надо сообщать отдельно.
      name: "claude-bridge",
      script: "tools/claude-bridge.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        BRIDGE_URL: "http://127.0.0.1:3000",
      },
    },
  ],
};
