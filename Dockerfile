FROM php:8.2-apache

RUN apt-get update && apt-get install -y --no-install-recommends \
    libzip-dev \
    unzip \
    ca-certificates \
    && docker-php-ext-install pdo pdo_mysql \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html
COPY . /var/www/html
RUN mkdir -p /var/www/html/logs \
    && chown -R www-data:www-data /var/www/html/logs \
    && chmod -R 775 /var/www/html/logs
    
# Redirect root URL to login page.
RUN printf '%s\n' '<?php header("Location: /frontend/pages/login.html"); exit; ?>' > /var/www/html/index.php

EXPOSE 10000

CMD ["sh", "-c", "PORT=${PORT:-10000}; sed -ri \"s/Listen 80/Listen ${PORT}/g\" /etc/apache2/ports.conf; sed -ri \"s/<VirtualHost \\*:80>/<VirtualHost *:${PORT}>/g\" /etc/apache2/sites-available/000-default.conf; apache2-foreground"]
