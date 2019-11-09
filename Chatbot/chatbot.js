
// Required modules.
const readline = require('readline');
const http = require('http')
const dgram = require('dgram');
const net = require('net');
const mqtt = require('mqtt');

const MQTT_HOST = 'mqtt://mqtt.fi.mdp.edu.ar';
const MQTT_TOPIC_BASE = 'ingenieria/anexo/';
const MQTT_TEMP_TOPIC = '/temperatura';

const MQTT_TEMP_QUESTION = 'Que temperatura hace?';

// NTP port over TCP.
const TCP_NTP_PORT = 8083;

// Global variables.
var activeMembers = []
var listenSocket = dgram.createSocket('udp4');
var sendSocket = dgram.createSocket('udp4');
var mqttClient = null;
var mqttLastTemperatures = { };
var mqttLastTempLocation = null;

const HEARTBEAT_INTERVAL_MSECS = 60000;

// Readline interface.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Send a message through UDP to all known members.
function sendMessage(from, to, message, timestamp, offset) {
  var serialized = JSON.stringify({
    from:from,
    to:to,
    message:message,
    timestamp:timestamp,
    offset:offset
  });

  for (let member of activeMembers) {
    sendSocket.send(serialized, member.port, member.ip);
  }
}

// Send a new member message through UDP to all new members to let
// everyone know there's a new chat room member. We don't have to wait
// for the next heartbeat this way.
function sendNewMemberMessage(username, ip, port) {
  var now = new Date();
  var serialized = JSON.stringify({
    username: username,
    ip: ip,
    port: port,
    timestamp: now.getTime()
  });

  for(let member of activeMembers) {
    sendSocket.send(serialized, member.port, member.ip);
  }
}

function requestRegister(host, username, ip, port) {
  console.log('Registering with HTTP server...');

  // Register on the HTTP server with the correct username, IP and port.
  // Encoding the username allows it to register with restricted characters correctly.
  var usernameURI = encodeURIComponent(username);
  const options = {
    hostname: host,
    port: 8080,
    path: `/register?username=${usernameURI}&ip=${ip}&port=${port}`,
    method: 'GET'
  };

  var req = http.request(options, res => {
    if (res.statusCode == 200) {
      var data = '';
      res.on('data', d => {
        data += d;
      });

      res.on('end', () => {
        activeMembers = JSON.parse(data);
        sendNewMemberMessage(username, ip, port);
      });
     }
     else {
       console.log(`Bad status code: ${res.statusCode}`);
     }
   });

   req.on('error', error => {
     console.error(error);
   });

   req.end();
}

// Register this client on the HTTP server.
const register = (host, username, ip, port, offset) => {
  return new Promise((resolve, reject) => {
    listenSocket.on('error', (err) => {
      console.error(`UDP Socket error:\n${err.stack}`);
    });

    listenSocket.on('message', (msg, rinfo) => {
      parsed = JSON.parse(msg);

      // New member message.
      if ('username' in parsed) {
        // Make sure the member isn't already on the list with the same IP/Port pair.
        var notFound = true;
        for(let member of activeMembers) {
          if ((member.ip == parsed.ip) && (member.port == parsed.port)) {
            notFound = false;
            break;
          }
        }
        
        // Add the new member to the array. This array will get overwritten in the next heartbeat.
        if (notFound) {
          activeMembers.push(parsed);
        }
      }
      // Chat message.
      else if ('message' in parsed) {
        var from = parsed.from;
        var message = parsed.message;
        var timestamp = new Date(parsed.timestamp + parsed.offset);
        var datestring = timestamp.toLocaleDateString();
        var timestring = timestamp.toLocaleTimeString();
        if (message == MQTT_TEMP_QUESTION) {
          if (mqttLastTempLocation != null) {
            var lastTemperature = mqttLastTemperatures[mqttLastTempLocation];
            var message = `Last temperature is ${lastTemperature} in ${mqttLastTempLocation}.`;
            
            var now = new Date();
            sendMessage(username, 'all', message, now.getTime(), offset);
            console.log(message);
          }
        }
      }
    });

    listenSocket.on('listening', () => {
      var chosenip = listenSocket.address().address;
      var chosenport = listenSocket.address().port;
      console.log(`Listening with UDP on port ${chosenport} at IP ${chosenip}`);
      setImmediate(requestRegister, host, username, chosenip, chosenport);
      setInterval(requestRegister, HEARTBEAT_INTERVAL_MSECS, host, username, chosenip, chosenport);
    });

    listenSocket.bind(port, ip);
    resolve();
  });
}

// Calculates the offset between this system and the NTP system. Allows for 
// synchronization across all clients.
const calculateOffsetNTP = (ip, port) => {
  return new Promise((resolve, reject) => {
    var client = new net.Socket();
    client.on('data', function(data) {
      var T4 = (new Date()).getTime();
      var times = data.toString().split(",");
      var T1 = parseInt(times[0]);
      var T2 = parseInt(times[1]);
      var T3 = parseInt(times[2]);
      var delay =  ((T2 - T1) + (T4 - T3)) / 2;
      var offset = ((T2 - T1) + (T3 - T4)) / 2;
      console.log('Delay: ' + delay + ' ms');
      console.log('Offset: ' + offset + ' ms');
      resolve(offset);
    });

    client.on('error', function(err) {
      console.log('Error when connecting to NTP server.');
      throw err;
    });

    console.log("Connecting to NTP server...");
    client.connect(port, ip, function() {
      console.log('Connected to NTP server. Sending current time...');
      var now = new Date();
      client.write(`${now.getTime()}`);
    });
  });
}

function startMQTT() {
  mqttClient = mqtt.connect(MQTT_HOST);
  mqttClient.on('connect', function () {
    mqttClient.subscribe(MQTT_TOPIC_BASE + '#', function (err) {
      if (!err) {
        console.log("Connected to MQTT.");
        //mqttClient.publish('/tominovino', 'Hello mqtt')
      }
    });
  });
    
  mqttClient.on('message', function (topic, message) {
    console.log(topic, ':', message.toString());

    if (topic.startsWith(MQTT_TOPIC_BASE)) {
      var parsed = JSON.parse(message.toString());
      var tempTopicPos = topic.search(MQTT_TEMP_TOPIC);
      if (tempTopicPos > 0) {
        var location = topic.substr(MQTT_TOPIC_BASE.length, tempTopicPos - MQTT_TOPIC_BASE.length);
        mqttLastTemperatures[location] = parsed['valor'];
        mqttLastTempLocation = location;
      }
    }
  });
}

// Ask a question to the user and use a default answer if they don't type in anything.
const question = (questionText, defaultAnswerText) => {
  return new Promise((resolve, reject) => {
    rl.question(questionText, (answer) => {
      if (answer == '') {
        answer = defaultAnswerText;
      }

      resolve(answer);
    })
  });
}

// Read the next line typed in by the user.
const nextmessage = () => {
  return new Promise((resolve, reject) => {
    rl.question('', (answer) => {
      resolve(answer);
    })
  });
}

// Main function.
const main = async () => {
  var host = await question('Enter the host address (empty for localhost): ', 'localhost');
  var offset = await calculateOffsetNTP(host, TCP_NTP_PORT);
  var username = await question('Enter your username (empty for Unknown): ', 'Unknown');
  var ip = await question('Enter your address (empty for 127.0.0.1): ', '127.0.0.1');
  var port = await question('Enter your port (empty or 0 for auto-detect): ', '0');
  await register(host, username, ip, port, offset);
  startMQTT();
  rl.close();
}

main()
