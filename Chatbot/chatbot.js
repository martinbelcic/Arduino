
// Required modules.
const readline = require('readline');
const http = require('http')
const dgram = require('dgram');
const net = require('net');
const mqtt = require('mqtt');

const MQTT_HOST = 'mqtt://mqtt.fi.mdp.edu.ar';
const MQTT_TOPIC_BASE = 'ingenieria/anexo/';
const MQTT_TEMP_TOPIC = '/temperatura';
const MQTT_CO_TOPIC = '/gas';
const MQTT_PROX_TOPIC = '/proximidad';
const MQTT_ORDER_TOPIC = '/bluetooth';

const MQTT_TEMP_QUESTION = 'Que temperatura hace?';
const MQTT_TEMP_QUESTION_LOCATION = 'Que temperatura hace en ';
const MQTT_CO_QUESTION = 'Que CO hay?';
const MQTT_CO_QUESTION_LOCATION = 'Que CO hay en ';
const MQTT_PROX_QUESTION = 'Que proximidad hay?';
const MQTT_PROX_QUESTION_LOCATION = 'Que proximidad hay en ';
const MQTT_ORDER_QUESTION = 'Cuantas ordenes hubo?';
const MQTT_ORDER_QUESTION_LOCATION = 'Cuantas ordenes hubo en ';
const MQTT_LED_QUESTION_ON = 'Prender LED de ';
const MQTT_LED_QUESTION_OFF = 'Apagar LED de ';
const MQTT_ENGINE_QUESTION_START = 'Girar motor a ';
const MQTT_ENGINE_QUESTION_MID = ' de ';

// NTP port over TCP.
const TCP_NTP_PORT = 8083;

// Global variables.
var activeMembers = []
var listenSocket = dgram.createSocket('udp4');
var sendSocket = dgram.createSocket('udp4');
var mqttClient = null;
var mqttLastTemperatures = { };
var mqttLastTempLocation = null;
var mqttLastCOs = { };
var mqttLastCOLocation = null;
var mqttLastProximities = { };
var mqttLastProximityLocation = null;
var mqttLastOrders = { };
var mqttLastOrderLocation = null;

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

function askSensor(username, offset, message, baseQuestion, locationQuestion, lastLocation, lastValues, sensorName) {
  if (message == baseQuestion) {
    if (lastLocation != null) {
      var lastValue = lastValues[lastLocation];
      var chatMessage = `Last ${sensorName} is ${lastValue} in ${lastLocation}.`;
      
      var now = new Date();
      sendMessage(username, 'all', chatMessage, now.getTime(), offset);
      console.log(chatMessage);
      return true;
    }
  }
  else if (message.startsWith(locationQuestion) && message.endsWith('?')){
      var location = message.substr(locationQuestion.length, message.length - locationQuestion.length - 1);
      if (location in lastValues) {
        var lastValue = lastValues[location];
        var chatMessage = `Last ${sensorName} is ${lastValue} in ${location}.`;
      }
      else {
        var chatMessage = `${location} is unknown.`;
      }
      
      var now = new Date();
      sendMessage(username, 'all', chatMessage, now.getTime(), offset);
      console.log(chatMessage);
      return true;
  }

  return false;
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
        
        if (askSensor(username, offset, message, MQTT_TEMP_QUESTION, MQTT_TEMP_QUESTION_LOCATION, mqttLastTempLocation, mqttLastTemperatures, "temperature")) { }
        else if (askSensor(username, offset, message, MQTT_CO_QUESTION, MQTT_CO_QUESTION_LOCATION, mqttLastCOLocation, mqttLastCOs, "CO")) { }
        else if (askSensor(username, offset, message, MQTT_PROX_QUESTION, MQTT_PROX_QUESTION_LOCATION, mqttLastProximityLocation, mqttLastProximities, "proximity")) { }
        else if (askSensor(username, offset, message, MQTT_ORDER_QUESTION, MQTT_ORDER_QUESTION_LOCATION, mqttLastOrderLocation, mqttLastOrders, "order count")) { }
        else if (message.startsWith(MQTT_LED_QUESTION_ON)) {
            var location = message.substr(MQTT_LED_QUESTION_ON.length, message.length - MQTT_LED_QUESTION_ON.length);
            var message_led = {
                'valor': true,
                'timestamp': (new Date()).getTime()
            };
            mqttClient.publish(MQTT_TOPIC_BASE + location + '/led', JSON.stringify(message_led));
            console.log(location + ' LED on.');
            sendMessage(username, 'all', location + ' LED on.', (new Date()).getTime(), offset);
        }
        else if (message.startsWith(MQTT_LED_QUESTION_OFF)) {
            var location = message.substr(MQTT_LED_QUESTION_OFF.length, message.length - MQTT_LED_QUESTION_OFF.length);
            var message_led = {
                'valor': false,
                'timestamp': (new Date()).getTime()
            };
            mqttClient.publish(MQTT_TOPIC_BASE + location + '/led', JSON.stringify(message_led));
            console.log(location + ' LED off.');
            sendMessage(username, 'all', location + ' LED off.', (new Date()).getTime(), offset);
        }
        else if (message.startsWith(MQTT_ENGINE_QUESTION_START)) {
            var midPos = message.search(MQTT_ENGINE_QUESTION_MID);
            if (midPos > 0) {
                var degreesPos = MQTT_ENGINE_QUESTION_START.length;
                var degrees = parseInt(message.substr(degreesPos, midPos - degreesPos)) % 360;
                var locationPos = midPos + MQTT_ENGINE_QUESTION_MID.length;
                var location = message.substr(locationPos, message.length - locationPos);
                if (location != '') {
                    var messageEngine = {
                        'valor': degrees,
                        'timestamp': (new Date()).getTime()
                    };

                    mqttClient.publish(MQTT_TOPIC_BASE + location + '/motor', JSON.stringify(messageEngine));

                    var chatMessage = `Set engine at ${location} to ${degrees} degrees.`;
                    console.log(chatMessage);
                    sendMessage(username, 'all', chatMessage, (new Date()).getTime(), offset);
                }
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
      try {
        var parsed = JSON.parse(message.toString());
        if (('valor' in parsed) && ('timestamp' in parsed)) {
          var tempTopicPos = topic.search(MQTT_TEMP_TOPIC);
          var coTopicPos = topic.search(MQTT_CO_TOPIC);
          var proxTopicPos = topic.search(MQTT_PROX_TOPIC);
          var orderTopicPos = topic.search(MQTT_ORDER_TOPIC);
          if (tempTopicPos > 0) {
            var location = topic.substr(MQTT_TOPIC_BASE.length, tempTopicPos - MQTT_TOPIC_BASE.length);
            mqttLastTemperatures[location] = parsed['valor'];
            mqttLastTempLocation = location;
            console.log(`Registered temperature ${mqttLastTemperatures[location]} at ${location}`);
          }
          else if (coTopicPos > 0) {
            var location = topic.substr(MQTT_TOPIC_BASE.length, coTopicPos - MQTT_TOPIC_BASE.length);
            mqttLastCOs[location] = parsed['valor'];
            mqttLastCOLocation = location;
            console.log(`Registered CO ${mqttLastCOs[location]} at ${location}`);
          }
          else if (proxTopicPos > 0) {
            var location = topic.substr(MQTT_TOPIC_BASE.length, proxTopicPos - MQTT_TOPIC_BASE.length);
            mqttLastProximities[location] = parsed['valor'];
            mqttLastProximityLocation = location;
            console.log(`Registered proximity ${mqttLastProximities[location]} at ${location}`);
          }
          else if (orderTopicPos > 0) {
            var location = topic.substr(MQTT_TOPIC_BASE.length, orderTopicPos - MQTT_TOPIC_BASE.length);
            mqttLastOrders[location] = parsed['valor'];
            mqttLastOrderLocation = location;
            console.log(`Registered order count ${mqttLastOrders[location]} at ${location}`);
          }
        }
        else {
          console.log('JSON does not have the expected parameters.');
        }
      } 
      catch(e) {
        alert(e);
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
