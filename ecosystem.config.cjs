require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  apps: [
    {
      name: 'rkm-visit-monitoring',
      script: './dist-server/server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        // Ambil PORT dari .env (kalau ada), fallback ke 3000.
        PORT: process.env.PORT || '3000',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      time: true,
    },
  ],
};
