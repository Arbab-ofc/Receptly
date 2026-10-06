module.exports = {
  apps: [
    {
      name: 'receptly',
      cwd: '/srv/receptly',
      script: 'apps/server/dist/apps/server/src/server.js',
      node_args: '--env-file=/srv/receptly/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      exp_backoff_restart_delay: 1000,
      env: { NODE_ENV: 'production' },
      out_file: '/srv/receptly/data/logs/out.log',
      error_file: '/srv/receptly/data/logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
