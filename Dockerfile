# Use official Playwright image which already has Chrome/Firefox/WebKit & deps
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy rest of the source
COPY . .

# Environment
ENV NODE_ENV=production

# Render will set PORT; just expose for documentation
EXPOSE 3000

# Start the service
CMD ["npm", "start"]
