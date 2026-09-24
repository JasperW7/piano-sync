mapping = [
    [0],
    [1],
    [2, 3],
    [4],
    [5, 6],
    [7],
    [8, 9],
    [10],
    [11, 12],
    [13],

    [14],
    [15],
    [16, 17],
    [18],
    [19],
    [20, 21],
    [22],
    [23],
    [24, 25],
    [26],
    [27, 28],
    [29],
    [30, 31],
    [32],
]

print("Mapping groups:", len(mapping))

used = [i for group in mapping for i in group]

print("Lyrics used:", len(used))
print("Expected:", list(range(33)))

missing = sorted(set(range(33)) - set(used))
duplicates = sorted(
    i for i in set(used)
    if used.count(i) > 1
)

print("Missing:", missing)
print("Duplicates:", duplicates)

for i, group in enumerate(mapping, 1):
    print(f"Segment {i:02d}: lyrics {group}")