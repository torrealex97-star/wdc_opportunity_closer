// Interrupción de voz: el eco de la propia locución no corta ni se dicta; una interrupción real sí corta.
import assert from 'node:assert/strict';
import { ECHO_MIN_WORDS, isEcho, overlap } from '../../apps/web/lib/voiceEcho.ts';

const spoken = 'Mira, ahora mismo no tengo tiempo para una llamada larga, cuéntame rápido qué ofreces';
assert.equal(isEcho('ahora mismo no tengo tiempo para una llamada', spoken), true, 'un trozo literal de lo que se lee es eco');
assert.equal(isEcho('Ahora mismo no tengo tiempo, para una LLAMADA larga!', spoken), true, 'mayúsculas, acentos y signos no engañan');
assert.equal(isEcho('espera, déjame hacerte una pregunta antes de seguir', spoken), false, 'una interrupción con palabras propias no es eco');
assert.equal(isEcho('no tengo tiempo', null), false, 'sin locución en curso nada es eco');
assert.equal(isEcho('no tengo tiempo', '  '), false, 'locución vacía = sin locución');
assert.equal(isEcho('espera', spoken), false, `con menos de ${ECHO_MIN_WORDS} palabras no se puede juzgar: se deja interrumpir`);
assert.equal(isEcho('no tengo', spoken), false, 'dos palabras tampoco se descartan');
assert.equal(overlap('', spoken), 0);
assert.ok(overlap('qué ofreces exactamente hoy', spoken) < 0.75, 'mitad y mitad no llega al umbral');
console.log('PASS  voz: el eco de la propia locución se ignora y una interrupción real corta');
