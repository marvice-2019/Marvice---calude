# Luftek Engineering static site — served by nginx (Coolify, Dockerfile build pack, base dir /luftek-website)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html about.html products.html industries.html projects.html certifications.html contact.html privacy-policy.html 404.html robots.txt sitemap.xml /usr/share/nginx/html/
COPY products/ /usr/share/nginx/html/products/
COPY assets/ /usr/share/nginx/html/assets/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
