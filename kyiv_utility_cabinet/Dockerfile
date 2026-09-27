FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
