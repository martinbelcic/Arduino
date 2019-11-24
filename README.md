Trabajo final para Sistemas Distribuidos.

## Archivos
* Node Red: Archivo exportado desde node-red, diagrama de funcionamiento para el registro de los valores del sensor de CO en la base de datos de InfluxDB y funcionamiento del dashboard que muestra los valores medidos.
* MQ9.pdf: Hoja de especificaciones del sensor utilizado.
* Chatbot/chatbot.js: Chat bot que tiene la capacidad de leer los mensajes y publicar mensajes a través de un broker MQTT. Lee los mensajes de los otros clientes de chats conectados al sistema para ejecutar comandos de consulta de los sensores o activación de actuadores.
* arduino/Arduino_gas_mqtt/Arduino_gas_mqtt.ino: Código fuente del programa cargado a la placa WeMos. Publica cada 1 segundo el valor del sensor a través del broker MQTT.

## Dependencias
* El uso del cliente de chat requiere de un servidor de chat al que se pueda conectar. Se recomienda utilizar el servidor incluido en la entrega anterior en https://github.com/DarioSamo/sd_chat
