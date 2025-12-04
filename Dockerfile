# Asosiy baza
FROM node:18-bullseye-slim

# Kerakli dasturlarni o'rnatish (Python, FFmpeg, yt-dlp)
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Ishchi papkani yaratish
WORKDIR /app

# Package fayllarni nusxalash
COPY package*.json ./

# Node modullarini o'rnatish
RUN npm install

# Barcha kodni nusxalash
COPY . .

# Portni ochish
EXPOSE 3000

# Botni ishga tushirish
CMD ["npm", "start"]