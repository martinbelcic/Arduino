#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
 
// Connect to the WiFi
const char* ssid = "patronatofi";
const char* password = "";
const char* mqtt_server = "200.0.183.33";
const char* mqtt_topic = "ingenieria/anexo/pasillo/gas";
 
WiFiClient espClient;
PubSubClient client(espClient);

/*
void callback(char* topic, byte* payload, unsigned int length) {
 Serial.print("Message arrived [");
 Serial.print(topic);
 Serial.print("] ");
 for (int i=0;i<length;i++) {
  char receivedChar = (char)payload[i];
  Serial.print(receivedChar);
  if (receivedChar == '0')
  // ESP8266 Huzzah outputs are "reversed"
  digitalWrite(ledPin, HIGH);
  if (receivedChar == '1')
   digitalWrite(ledPin, LOW);
  }
  Serial.println();
}
*/
 
void reconnect() {
  // Loop until we're reconnected
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Attempt to connect
 
    if (client.connect("Archino Client")) {
      Serial.println("connected");
      //client.subscribe("/#");
    }
    else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

float sensorValue() {
  float sensorValue;
  sensorValue = analogRead(A0);
  Serial.println(sensorValue);
  Serial.println(sensorValue/1024*5.0);
  return sensorValue/1024*5.0;
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  Serial.println("");

  // Wait for connection
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.print("Connected to ");
  Serial.println(ssid);
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  client.setServer(mqtt_server, 1883);
  //client.setCallback(callback);
}
 
void loop() {
  if (!client.connected()) {
    reconnect();
  } 
  else {
    char payload[256];
    sprintf(payload, "{\"valor\":%f, \"timestamp\":%d}", sensorValue(), millis());
    Serial.print("Publicando ");
    Serial.println(payload);
    client.publish(mqtt_topic, payload);
    delay(1000);
  }
  
  client.loop();
}
