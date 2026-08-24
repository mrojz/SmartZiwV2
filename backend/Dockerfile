# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

# Install Chromium + ChromeDriver + dependencies for Selenium, plus git for Smart-Ziw mirror pushes.
# The apt cache is kept in a BuildKit cache mount so packages are not re-downloaded every build.
# deb.debian.org (Fastly) is slow/flaky over this host's IPv6-only network; the
# OVH mirror (debian.mirrors.ovh.net) is ~7x faster here. This sed also remaps
# the security suite, since the mirror path prefix is shared.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    sed -i 's#http://deb.debian.org/debian#http://debian.mirrors.ovh.net/debian#g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update -o Acquire::Retries=3 \
    && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# (No libxml2-dev/libxslt1-dev/build-essential layer: requirements.txt is fully
# pinned and every package installs from a manylinux wheel, so nothing compiles
# from source. The old layer also broke builds on IPv6-only networks.)

# Tell Selenium where to find Chrome and ChromeDriver
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install Python dependencies. The pip wheel cache is kept in a BuildKit cache mount
# so only changed packages are re-downloaded when requirements.txt is updated.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
