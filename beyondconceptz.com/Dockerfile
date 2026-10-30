# Static site for beyondconceptz.com, served by nginx on Coolify.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
