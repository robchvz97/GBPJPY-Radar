# GBPJPY Radar v1

MVP personal para GBP/JPY:
- Tendencia estructural en 15 minutos (HH/HL o LH/LL).
- Soporte y resistencia por pivotes confirmados en 5 minutos.
- Confirmación por vela de rechazo en 5 minutos.
- Señales estrictas con R:R fijo 2:1.
- NO TRADE cuando falta cualquier condición.
- Diario local con resultados, notas, capturas, win rate, R y expectativa.
- Notificaciones mientras la app está abierta.

## Feed de mercado
La v1 usa el endpoint chart de Yahoo Finance como feed experimental, sin API key. No es un feed de ejecución ni se garantiza su disponibilidad. Confirma cualquier nivel con tu broker. En una v2 se puede cambiar por OANDA/Twelve Data/broker API.

## Despliegue
Sube todos los archivos a un repositorio nuevo en GitHub y conéctalo a Vercel. No requiere variables de entorno en esta v1.
