{ pkgs, ... }:

{
  languages.deno.enable = true;
  packages = [ pkgs.nix-prefetch-git ];
}
