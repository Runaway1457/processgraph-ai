# Methodology and claim boundaries

## Discovery

The engine builds a directly-follows graph and recursively applies sequence, exclusive-choice and concurrency cuts. When a clean cut cannot be found, it falls back to an explicit XOR over observed variants and increments `fallbackCount`. The output is therefore inspectable: the product never silently calls a fallback a perfect Inductive Miner result.

## Conformance

Cases are split deterministically into train and holdout partitions by case ID. Holdout traces are aligned to the discovered training language using unit-cost synchronous, log and model moves. Reported fitness, precision and generalization belong to that split and are not Petri-net token-replay metrics.

## Bottlenecks and variants

Waiting time is reported as a distribution (minimum, quartiles, median, P90, P95, maximum and standard deviation), never only as an average. Variants are exact activity sequences ranked by frequency and by median lead-time impact.

## Simulation

Arrivals use an exponential inter-arrival model estimated from observed case starts. Each transition compares exponential and log-normal candidates by BIC and reports a Kolmogorov–Smirnov diagnostic. Cases sample observed variants; activities use resource-derived capacities and a working-calendar multiplier. A scenario reports the median and empirical central 95% interval across replication medians.

Historical validation compares the baseline simulated median with the observed median. A failed tolerance gate keeps the diagnostic visible but marks the scenario unfit for decision support. When only completion timestamps exist, inter-event gaps combine waiting and service; every result carries that warning.
