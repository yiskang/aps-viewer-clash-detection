# D-V6 headed evidence — manifest (added 2026-10-08, addresses review L1)

Screenshots (owner/subagent headed runs, normal app, SVF2) + one console text file. Caveat: `console-warnings-errors.txt` header says `Errors: 0` but its body retains two token-refresh failures (four `[ERROR]` entries) without timestamps; no timing/causality claim is made from it. Self-clash screenshots are pre-Option-A (18:04 at 67%, 80/4,294 units); superseded by the post-A and post-D/E profiles under `../2026-10-07-self-clash-*`.

| File | SHA-256 |
|---|---|
| Architecture-vs-Mechanical.png | 8792e4cc96e0923f3213f71bb5b05841c0a1ddd721af2035b507656bbf4dc9a3 |
| Architecture-vs-self-after-stop.png | 6e1b3a3d1e33ad6646553c356645d3a0b90f8b545d0da0512f04f0c696ee028c |
| Architecture-vs-self-in-progress.png | 50dfeb2cc3bd0435f72a352629c846588e7ebbc0d1e34214aba89e7990804062 |
| Architecture-vs-Structure.png | 37b90ed2bdffd50b646db7534199aee5f24fc6ae6534b1ad2b368d7df8d01e17 |
| console-warnings-errors.txt | 528e121562cde3de64547fedb3966341a27fb40ba06ada35002ef834b1ffbf70 |
| Mechanical-vs-Architecture.png | eb590bd7d8d01b4f8e27a0ac3fe3b74a1b0791acf89ba1b001f34ad83795b82d |
| Mechanical-vs-Structure.png | 0dc36fab64dd5a974953dca73585e250b9eaf744ada31055e648977f15fa6f6d |
| Structure-vs-Architecture.png | e979e769e162ea87d16318b64c1e4a19252c3f2f65cb66db977c4aa39d66a25e |
| Structure-vs-Mechanical.png | 2d3252b5f6f7175941dc8d92d52055461c2d6436ef92c53e76420e02bd1c394c |

Verify: `shasum -a 256 $(ls | grep -v "^README.md$")`
