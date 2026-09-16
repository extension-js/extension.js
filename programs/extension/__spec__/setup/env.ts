process.env.FORCE_COLOR = '0'
process.env.NO_COLOR = '1'

// Same contract for verbosity: author-mode envs add debug lines that break
// exact-output assertions. Specs that test debug behavior set these
// themselves per-test; the suite baseline is the default tier.
Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
