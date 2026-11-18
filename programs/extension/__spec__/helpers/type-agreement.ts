export type Same<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false

export type Extra<A, B> = Exclude<keyof A, keyof B>

// Shared keys whose type or optionality is not the same on both sides.
export type Differing<A, B> = {
  [K in keyof A & keyof B]-?: Same<Pick<A, K>, Pick<B, K>> extends true
    ? never
    : K
}[keyof A & keyof B]

// True when both sides agree, apart from the keys named as known exceptions.
// An exception that stops being one fails too, so the list cannot go stale.
export type Agrees<
  Ours,
  Engine,
  OursOnly extends PropertyKey = never,
  Differs extends PropertyKey = never
> = [
  Same<Extra<Engine, Ours>, never>,
  Same<Extra<Ours, Engine>, OursOnly>,
  Same<Differing<Ours, Engine>, Differs>
] extends [true, true, true]
  ? true
  : {
      engineOnly: Extra<Engine, Ours>
      oursOnly: Extra<Ours, Engine>
      differing: Differing<Ours, Engine>
    }

// True when a value of ours can be handed to the engine where it asks for one.
export type Fits<Ours, Engine> = [Ours] extends [Engine] ? true : false
