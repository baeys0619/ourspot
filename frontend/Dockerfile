# 정적 파일은 Apache가 제공한다. API 경로는 브라우저가 접속한 Nginx에서 분기한다.
ARG FRONT_BASE=httpd:2.4-bookworm
FROM ${FRONT_BASE}
# Apache의 기본 정적 문서 경로에 파일을 포함하므로 소스 bind mount 없이 실행한다.
COPY frontend/index.html frontend/login.html frontend/place.html frontend/plans.html /usr/local/apache2/htdocs/
COPY frontend/css/ /usr/local/apache2/htdocs/css/
COPY frontend/js/ /usr/local/apache2/htdocs/js/
# Apache가 컨테이너 안에서 기본 문서에 HTTP 200을 응답하는지 확인한다.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/80; printf "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3; head -n 1 <&3 | grep -q "200 OK"'
