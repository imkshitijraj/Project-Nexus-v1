FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run check && npm run typecheck
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174
USER node
EXPOSE 4174
CMD ["npm", "run", "start:server"]
