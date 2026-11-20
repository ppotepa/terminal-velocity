export function readPreviewArguments(argv) {
  const input = {};
  if (argv[0] !== '--live') throw new Error('Explicit --live is required.');
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--lat', '--lon', '--radius-nm', '--port'].includes(key) || value === undefined || key in input)
      throw new Error('Expected --lat, --lon, --radius-nm and optional --port.');
    input[key] = value;
  }
  if (!['--lat', '--lon', '--radius-nm'].every(key => key in input))
    throw new Error('Missing preview coordinates or radius.');
  for (const value of Object.values(input)) if (!/^-?(?:\d+)(?:\.\d+)?$/u.test(value))
    throw new Error('Preview arguments must be decimal numbers.');
  return {
    query: { latitude: Number(input['--lat']), longitude: Number(input['--lon']), radiusNm: Number(input['--radius-nm']) },
    port: input['--port'] === undefined ? 3001 : Number(input['--port']),
  };
}
