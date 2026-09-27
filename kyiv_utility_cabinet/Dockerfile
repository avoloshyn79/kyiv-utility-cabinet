FROM mcr.microsoft.com/playwright:v1.48.0-jammy

# Xvfb + x11vnc + noVNC/websockify are used only for the one-time
# interactive Kyivvodokanal profile setup (kyivvodokanal.setup_mode) - see
# src/kyivvodokanal-setup.mjs. That step launches Playwright's own bundled
# Chromium binary directly as a plain process (no CDP attached at all), so a
# real person can sign into Google exactly like an ordinary browser user -
# Google refuses that sign-in outright when it detects Playwright's own
# launch()/launchPersistentContext() APIs driving the browser.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
