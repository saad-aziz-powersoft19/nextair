module.exports = {
  apps: [
    {
      name: 'nextair',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3005',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3005,
      },
    },
  ],
};

