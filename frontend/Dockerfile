FROM node:20-alpine

WORKDIR /app

# Copy only package files first (speeds up rebuilds)
COPY package*.json ./
RUN npm install

# Copy only source files after install
COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
