# Archived BPAN contracts

Historical registry sources, deployment record, administration/migration tools,
and tests. These files are retained as reference only and are outside the active
Hardhat source and test paths. They are not imported by either wallet or by the
new Base contract. Historical relative paths in the scripts/tests are preserved;
they are not a supported runnable deployment package.

The active contract is `../../core/BANPRegistryBase.sol`. It is independent of
these sources, starts empty at zero registration fee, and exposes no migration
or import functions. All registrations on Base are new.
