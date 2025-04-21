/**
 * app.js
 *
 */

const util = require("util");
const { IEC104Client } = require('ih-lib60870-node');

module.exports = async function (plugin) {
  let clients = {};
  let channelsObj = {};
  let channels = await plugin.channels.get();
  const params = plugin.params.data;
  //plugin.log('Received channels data: ' + util.inspect(channels), 2);
  channelsObj = groupByTwoMap(channels, 'nodeip', 'nodeport');
  //plugin.log('Received channels data: ' + util.inspect(channelsObj, null, 4), 2);
  Object.keys(channelsObj).forEach(key => {
    clients[key] = new IEC104Client((event, data) => {
      plugin.log(`Server ${key} Event: ${event}, Data: ${util.inspect(data)}`, 2);
      if (event == 'conn' && data.event === 'opened') clients[key].sendStartDT();
      if (event == 'conn' && data.event === 'activated') {
        const success = clients[key].sendCommands([{ typeId: 100, ioa: 0, value: 20 }]);
        plugin.log("success " + success);
      }
      if (event == 'data') {
        let sendArr = [];
        data.forEach(item => {
          const addrArr = channelsObj[item.clientID].objects[String(item.asdu) + "_" + String(item.ioa)];
          if (addrArr && addrArr.length > 0) {
            addrArr.forEach(addr => {
              const obj = {};
              if (addr.bit) {
                obj.value = item.val & Math.pow(2, Number(addr.offset)) ? 1 : 0;
              } else {
                obj.value = item.val
              }
              if (item.timestamp != undefined) {
                obj.ts = item.timestamp + Number(addr.tzondevice) * (-3600000);
              } else {
                obj.ts = Date.now();
              }
              obj.id = addr.id;
              obj.chstatus = item.quality;
              obj.title = addr.title;
              obj.parentname = addr.parentname;
              sendArr.push(obj);

            })
          }


        });
        if (sendArr.length > 0) plugin.sendData(sendArr);
      }


    });
    try {
      clients[key].connect({
        ip: channelsObj[key].nodeip,
        port: Number(channelsObj[key].nodeport),
        ipReserve: channelsObj[key].use_redundancy ? channelsObj[key].host_redundancy : "",
        asduAddress: Number(channelsObj[key].asduAddress),
        clientID: key,
        originatorAddress: Number(params.originatorAddress),
        k: channelsObj[key].k,
        w: channelsObj[key].w,
        t0: channelsObj[key].t0,
        t1: channelsObj[key].t1,
        t2: channelsObj[key].t2,
        t3: channelsObj[key].t3,
        reconnectDelay: 2
      });
    } catch (e) {
      plugin.log("Connection create error " + util.inspect(e), 1);
    }

  })

  plugin.onAct(async (message) => {
    plugin.log('ACT data=' + util.inspect(message.data), 1);
    const writeObj = groupByTwoMap(message.data, 'nodeip', 'nodeport');

    Object.keys(writeObj).forEach(key => {
      let writeArr = [];
      const nodeipport = writeObj[key].nodeip + "_" + writeObj[key].nodeport;
      const asdu = item.asduGroup ? item.asduGroupAddress : item.asduAddress;
      Object.keys(writeObj[key].objects).forEach(key1 => {
        writeObj[key].objects[key1].forEach(item => {
          let val;
          if (item.ioObjCtype == 45) {
            val = item.value == 1 ? true : false;
          } else {
            val = item.value;
          }
          writeArr.push({ typeId: Number(item.ioObjCtype), ioa: item.objAdr, asdu, value: val, bselCmd: item.selCmd, ql: Number(item.ql) });
        })
      })
      try {
        const success = clients[nodeipport].sendCommands(writeArr);
        plugin.log(success ? "Commands Success" : "Commands Failed", 2);
      } catch (e) {
        plugin.log("Write error: " + util.inspect(e));
      }

    })
  });

  plugin.channels.onChange(async () => {
    channels = await plugin.channels.get();
    channelsObj = groupByTwoMap(channels, 'nodeip', 'nodeport');
  });

  // Завершение работы
  async function terminate() {


    plugin.exit();
  }

  //process.on('exit', terminate);
  process.on('SIGTERM', async () => {
    // Object.keys(clients).forEach(key => {
    //   clients[key].disconnect();
    // })
    plugin.exit();
  });

  // --- События плагина ---
  // Сканирование
  plugin.onScan(async (scanObj) => {
    plugin.log("scanObj " + util.inspect(scanObj, null, 4))

  });

  function groupByTwoMap(array, key1, key2) {
    const map = new Map();

    array.forEach(item => {
      const primaryKey = `${item[key1]}_${item[key2]}`; // Формируем ключ как "nodeip_nodeport"
      const asdu = item.asduGroup ? item.asduGroupAddress : item.asduAddress;
      const secondaryKey = asdu + "_" + item.objAdr  // Используем asdu + objAdr как второй уровень
      if (!map.has(primaryKey)) {
        // Инициализируем объект с дополнительными свойствами
        map.set(primaryKey, {
          nodeip: item[key1],
          nodeport: item[key2],
          asduAddress: asdu,
          use_redundancy: item.use_redundancy,
          host_redundancy: item.host_redundancy,
          k: item.k,
          w: item.w,
          t0: item.t0,
          t1: item.t1,
          t2: item.t2,
          t3: item.t3,
          objects: new Map() // Для хранения объектов второго уровня
        });
      }

      const group = map.get(primaryKey);

      if (!group.objects.has(secondaryKey)) {
        group.objects.set(secondaryKey, []);
      }

      group.objects.get(secondaryKey).push(item);
    });

    // Преобразование Map в объект
    return Object.fromEntries(
      Array.from(map.entries()).map(([k1, v1]) => [
        k1,
        {
          nodeip: v1.nodeip,
          nodeport: v1.nodeport,
          asduAddress: v1.asdu,
          use_redundancy: v1.use_redundancy,
          host_redundancy: v1.host_redundancy,
          k: v1.k,
          w: v1.w,
          t0: v1.t0,
          t1: v1.t1,
          t2: v1.t2,
          t3: v1.t3,
          objects: Object.fromEntries(v1.objects)
        }
      ])
    );
  };

};

