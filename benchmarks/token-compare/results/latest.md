# Token compare — 2026-08-16T22:30:31.032Z

Provider: DeepSeek direct · Base: `https://api.deepseek.com`

Arms: **normal** = realistic agent + tools (engines off, still DeepSeek auto cache) · **engines** = same prefix + engine context blocks.

## Model `deepseek-v4-flash`

| Arm | Calls | Input | Fresh input | Cache read | Cache % of input | Output | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| normal | 8 | 6288 | 1040 | 5248 | 83.5% | 1634 | 7922 |
| engines | 8 | 10088 | 872 | 9216 | 91.4% | 1467 | 11555 |

### Delta (normal cache → engines-on cache)
- Cache read: **5248** → **9216** (Δ **3968**)
- Cache % of input: **83.5%** → **91.4%**
- Fresh input: **1040** → **872** (Δ **-168**)
- Total input: **6288** → **10088** (engines add **3800** input tokens; most should be cacheable)

### Per-prompt

#### normal
| id | input | cache | fresh | output |
|---|---:|---:|---:|---:|
| greet | 774 | 640 | 134 | 113 |
| explain-auth | 786 | 640 | 146 | 97 |
| explain-auth-repeat | 786 | 768 | 18 | 256 |
| small-fix | 784 | 640 | 144 | 214 |
| small-fix-tweak | 785 | 640 | 145 | 186 |
| debug | 796 | 640 | 156 | 256 |
| refactor | 789 | 640 | 149 | 256 |
| frontend | 788 | 640 | 148 | 256 |

#### engines
| id | input | cache | fresh | output |
|---|---:|---:|---:|---:|
| greet | 1249 | 1152 | 97 | 254 |
| explain-auth | 1261 | 1152 | 109 | 164 |
| explain-auth-repeat | 1261 | 1152 | 109 | 73 |
| small-fix | 1259 | 1152 | 107 | 129 |
| small-fix-tweak | 1260 | 1152 | 108 | 79 |
| debug | 1271 | 1152 | 119 | 256 |
| refactor | 1264 | 1152 | 112 | 256 |
| frontend | 1263 | 1152 | 111 | 256 |

## Model `deepseek-v4-pro`

| Arm | Calls | Input | Fresh input | Cache read | Cache % of input | Output | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| normal | 8 | 6288 | 1040 | 5248 | 83.5% | 1425 | 7713 |
| engines | 8 | 10088 | 872 | 9216 | 91.4% | 1565 | 11653 |

### Delta (normal cache → engines-on cache)
- Cache read: **5248** → **9216** (Δ **3968**)
- Cache % of input: **83.5%** → **91.4%**
- Fresh input: **1040** → **872** (Δ **-168**)
- Total input: **6288** → **10088** (engines add **3800** input tokens; most should be cacheable)

### Per-prompt

#### normal
| id | input | cache | fresh | output |
|---|---:|---:|---:|---:|
| greet | 774 | 640 | 134 | 103 |
| explain-auth | 786 | 640 | 146 | 97 |
| explain-auth-repeat | 786 | 768 | 18 | 179 |
| small-fix | 784 | 640 | 144 | 114 |
| small-fix-tweak | 785 | 640 | 145 | 164 |
| debug | 796 | 640 | 156 | 256 |
| refactor | 789 | 640 | 149 | 256 |
| frontend | 788 | 640 | 148 | 256 |

#### engines
| id | input | cache | fresh | output |
|---|---:|---:|---:|---:|
| greet | 1249 | 1152 | 97 | 118 |
| explain-auth | 1261 | 1152 | 109 | 190 |
| explain-auth-repeat | 1261 | 1152 | 109 | 256 |
| small-fix | 1259 | 1152 | 107 | 141 |
| small-fix-tweak | 1260 | 1152 | 108 | 92 |
| debug | 1271 | 1152 | 119 | 256 |
| refactor | 1264 | 1152 | 112 | 256 |
| frontend | 1263 | 1152 | 111 | 256 |
