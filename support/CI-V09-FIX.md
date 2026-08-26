# v0.9 Windows task runner CI validation

This marker PR validates the Windows `.cmd/.bat` hidden-process wrapper introduced after regression run `32987684365` failed with `spawn EINVAL` on `npm.cmd`.
