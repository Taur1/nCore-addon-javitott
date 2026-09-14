FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

# Ha valamiért nem egyezne a lock fájl, inkább installáljuk le.
RUN npm install

RUN npm install form-data

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
