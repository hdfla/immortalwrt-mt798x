'use strict';
'require baseclass';
'require rpc';
'require network';

var callSwconfigPortState = rpc.declare({
  object: 'luci',
  method: 'getSwconfigPortState',
  params: ['switch'],
  expect: { result: [] }
});

var callLuciBoardJSON = rpc.declare({
  object: 'luci-rpc',
  method: 'getBoardJSON',
  expect: { '': {} }
});

var callLuciNetworkDevices = rpc.declare({
  object: 'luci-rpc',
  method: 'getNetworkDevices',
  expect: { '': {} }
});

function formatSpeed(speed) {
  if (speed <= 0) return '-';
  const speedInt = parseInt(speed);
  if (isNaN(speedInt)) return '-';
  return speedInt < 1000 ? `${speedInt} M` : `${speedInt / 1000} GbE`;
}

function getPortColor(carrier, duplex) {
  if (!carrier) return 'Gainsboro;';
  if (duplex === 'full' || duplex === true) return 'greenyellow;';
  return 'darkorange';
}

function getPortIcon(carrier) {
  return L.resource(`icons/port_${carrier ? 'up' : 'down'}.png`);
}

function getPorts(board, netdevs, switches) {
  const ports = [];
  if (Object.keys(switches).length === 0) {
    const network = board.network;
    const ifnames = [network?.wan?.device].concat(network?.lan?.ports);
    for (const ifname of ifnames) {
      if (ifname in netdevs === false) continue;
      const dev = netdevs[ifname];
      ports.push({
        ifname: dev.name,
        carrier: dev.link.carrier,
        duplex: dev.link.duplex,
        speed: dev.link.speed,
        tx_bytes: dev.stats.tx_bytes,
        rx_bytes: dev.stats.rx_bytes
      });
    }
    return ports;
  }

  const switch0 = switches.switch0;
  const lan = netdevs['br-lan'];
  const wan = netdevs[board.network.wan.device];
  let portInfo = {};
  let wanInSwitch = false;
  for (const port of switch0.ports) {
    const label = port.label.toUpperCase();
    const { link, duplex, speed } = switch0.portstate[port.num];
    portInfo = {
      ifname: label,
      carrier: link,
      duplex,
      speed,
      tx_bytes: 0,
      rx_bytes: 0
    };

    if (label.startsWith('WAN')) {
      wanInSwitch = true;
      if (wan) {
        portInfo.tx_bytes = wan.stats.tx_bytes;
        portInfo.rx_bytes = wan.stats.rx_bytes;
      }
      ports.unshift(portInfo);
    } else if (label.startsWith('LAN')) {
      if (lan && link) {
        portInfo.tx_bytes = lan.stats.tx_bytes;
        portInfo.rx_bytes = lan.stats.rx_bytes;
      }
      ports.push(portInfo);
    }
  }
  if (wanInSwitch) return ports;

  if (wan) {
    ports.unshift({
      ifname: 'WAN',
      carrier: wan.link.carrier,
      duplex: wan.link.duplex,
      speed: wan.link.speed,
      tx_bytes: wan.stats.tx_bytes,
      rx_bytes: wan.stats.rx_bytes
    });
  }
  return ports;
}

function renderPorts(data) {
  const css = {
    grids: `
      display: grid; grid-gap: 5px 10px;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      margin-bottom: 1em;
    `,
    head: `
      color: Black;
      text-align: center;
      font-weight: bold;
      border-radius: 7px 7px 0 0;
    `,
    body: `
      border: 1px solid lightgrey;
      border-radius: 0 0 7px 7px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;`,
    icon: 'margin: 5px; width: 32px;',
    speed: 'font-size: 0.8rem; font-weight: bold;',
    traffic: `
      border-top: 1px solid lightgrey;
      font-size: 0.8rem;`
  };

  const ports = [];
  getPorts(...data).forEach((port) => {
    const { carrier, duplex } = port;
    const ifname = port.ifname.replace(' ', '');
    const color = `background-color: ${getPortColor(carrier, duplex)};`;
    ports.push(
      E('div', {}, [
        E('div', { style: css.head + color }, ifname),
        E('div', { style: css.body }, [
          E('img', { style: css.icon, src: getPortIcon(carrier) }),
          E('div', { style: css.speed }, formatSpeed(port.speed)),
          E('div', { style: css.traffic }, [
            '\u25b2\u202f%1024.1mB'.format(port.tx_bytes),
            E('br'),
            '\u25bc\u202f%1024.1mB'.format(port.rx_bytes)
          ])
        ])
      ])
    );
  });

  return E('div', { style: css.grids }, ports);
}

return baseclass.extend({
  title: _('Ethernet Information'),

  load: function () {
    return Promise.all([
      L.resolveDefault(callLuciBoardJSON(), {}),
      L.resolveDefault(callLuciNetworkDevices(), {}),
      network.getSwitchTopologies().then((topologies) => {
        const switches = Object.keys(topologies);
        if (switches.length === 0) return {};
        switches.forEach((name) => {
          callSwconfigPortState(name).then((ports) => {
            topologies[name].portstate = ports;
          });
        });
        return topologies;
      })
    ]);
  },

  render: function (data) {
    return renderPorts(data);
  }
});
