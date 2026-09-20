FROM node:22-alpine

WORKDIR /app

# better-sqlite3 fordításához szükséges csomagok
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

COPY package*.json ./

RUN npm install
RUN npm install form-data

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
