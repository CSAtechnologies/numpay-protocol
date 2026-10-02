// Local QA bridge: Expo binds ::1 but adb reverse connects over IPv4.
const net = require('node:net');
net.createServer((client) => {
  const upstream = net.connect(8081, '::1');
  client.pipe(upstream).pipe(client);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
}).listen(8081, '127.0.0.1');
