# domcub_employee
app for empoyers to manage employees

## Notificaciones push

Los avisos de la campana sólo existen mientras la página está abierta. Para
que llegue algo con la pestaña cerrada hay tres piezas:

| Pieza | Dónde |
|---|---|
| Permiso del navegador y token del aparato | `app.js` (`setupPush`, `activarPush`) |
| Aviso con la pestaña cerrada | `firebase-messaging-sw.js`, en la raíz del sitio |
| Envío | `functions/index.js`, una Cloud Function |

El envío no puede hacerse desde la página: necesita una credencial de
servidor, y ahí cualquiera podría leerla. La función se dispara al crearse
un mensaje y avisa a los participantes del chat (o a todos, si es un
anuncio), nunca a quien lo escribió.

### Puesta en marcha

1. **Clave VAPID.** Firebase Console → Configuración del proyecto → Cloud
   Messaging → *Certificados push web* → Generar par de claves. Se copia la
   clave pública y se pega en `VAPID_KEY`, dentro de `firebase-config.js`
   (y en `app.js` del portal). Mientras esté vacía no se pide permiso a
   nadie y el resto de la aplicación funciona igual.
2. **Plan Blaze.** Las Cloud Functions lo exigen. Con este volumen de
   mensajes el gasto real es de céntimos, pero hay que introducir una
   tarjeta.
3. **Desplegar la función:**
   ```
   npm install -g firebase-tools
   firebase login
   firebase deploy --only functions
   ```
4. **Publicar las reglas**, que ahora incluyen `PushTokens`.

### Detalles que conviene saber

- Hace falta **HTTPS**. Netlify ya lo da.
- En **iPhone** sólo funciona si el portal se añade a la pantalla de inicio
  (Compartir → Añadir a inicio). Es una limitación de Safari, no del código.
- El permiso se pide con un botón, no al entrar: si el navegador recibe un
  «no», no vuelve a preguntar.
- Los tokens caducados se borran solos cuando FCM los rechaza.

## Pruebas

```
node tests/nomina.test.js
```

Comprueba el cálculo de la nómina con colecciones simuladas: que las horas
sumen sólo turnos cerrados, que ninguna tarifa vacía produzca NaN, y que
volver a generar no reescriba un recibo ya pagado.
