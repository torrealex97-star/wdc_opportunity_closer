// Salón del éxito: trece casos reales, cada uno con su vídeo, su aprendizaje y su mensaje.
// Un id de YouTube mal copiado deja la tarjeta sin vídeo y la alumna sin historia, así que se comprueba
// aquí, sin red: que estén las trece personas, que cada id sea válido y que no haya campos vacíos.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/successstories.mjs
import assert from 'node:assert/strict';
import { SUCCESS_STORIES, youtubeEmbed, youtubeWatch } from '../../apps/web/lib/successStories.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (error) { results.push(['FAIL', name, error.message.split('\n')[0]]); } };

const NAMES = ['Briana', 'Bea', 'Angy', 'Monica', 'Aranxa', 'Carla Segura', 'Yamila', 'Maitane', 'Jenifer', 'Lisette', 'Anahita', 'Noelia', 'Marta'];
const VIDEOS = {
  Briana: 'dpdaZecblNk', Bea: 'RL0VhEPb8sE', Angy: 'mY2fLdEgnuk', Monica: 'OtFwlzJz-0s', Aranxa: 'AuOlvXqqZuo',
  'Carla Segura': 'ZsZVlkDok-c', Yamila: 'UfFV5mweum4', Maitane: 'yJ6_z24JEeE', Jenifer: 'Ladi3gx7Fzo',
  Lisette: 'XIMNWEw299g', Anahita: 'RjGnH7uZd6g', Noelia: 'P9NXvsMwxYE', Marta: 'WnVgKFSjm1M',
};

step('están las trece alumnas, en el orden en que se presentan', () => {
  assert.deepEqual(SUCCESS_STORIES.map(story => story.name), NAMES);
});

step('cada ficha enlaza a su vídeo, sin ids repetidos ni mal formados', () => {
  for (const story of SUCCESS_STORIES) {
    assert.equal(story.videoId, VIDEOS[story.name], `${story.name}: id de YouTube`);
    assert.match(story.videoId, /^[A-Za-z0-9_-]{11}$/, `${story.name}: formato de id`);
    assert.equal(story.id, story.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-'), `${story.name}: id de ficha`);
  }
  assert.equal(new Set(SUCCESS_STORIES.map(story => story.videoId)).size, SUCCESS_STORIES.length, 'ningún vídeo se repite');
  assert.equal(new Set(SUCCESS_STORIES.map(story => story.id)).size, SUCCESS_STORIES.length, 'ninguna ficha se repite');
});

step('ninguna tarjeta sale sin tema, aprendizaje o mensaje', () => {
  for (const story of SUCCESS_STORIES) {
    assert.ok(story.theme.trim().length > 2, `${story.name}: tema`);
    for (const field of ['learn', 'message']) {
      assert.equal(typeof story[field], 'string', `${story.name}: ${field}`);
      assert.ok(story[field].trim().length > 20, `${story.name}: ${field} demasiado corto`);
    }
  }
});

step('el reproductor no carga solo y apunta al vídeo de esa persona', () => {
  const embed = youtubeEmbed('dpdaZecblNk');
  assert.match(embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dpdaZecblNk\?/);
  assert.match(embed, /autoplay=1/, 'el clic ya expresa la intención de verlo');
  assert.equal(youtubeWatch('dpdaZecblNk'), 'https://youtu.be/dpdaZecblNk');
});

let failures = 0;
for (const [status, name, detail] of results) {
  if (status === 'FAIL') { failures += 1; console.log(`FAIL  ${name}`); if (detail) console.log(`      ${detail}`); }
  else console.log(`PASS  ${name}`);
}
console.log(`\n${results.length - failures}/${results.length} pasos OK`);
process.exitCode = failures ? 1 : 0;
