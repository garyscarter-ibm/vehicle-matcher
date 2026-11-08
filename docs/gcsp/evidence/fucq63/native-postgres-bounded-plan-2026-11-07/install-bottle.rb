# Pinned Homebrew library route preserves old prefix links: never invokes Install.install_formula's unlink-upgrade wrapper.
require 'formula_installer'
require 'formulary'
class NativeProofBottleInstaller < FormulaInstaller
  def build
    raise 'Source compilation is forbidden for this bounded native proof'
  end
  def install_service
    # Service registration/plist/default global var/log setup is outside this proof.
  end
end
raise 'One exact local archive required' unless ARGV.length == 1
archive = Pathname(ARGV.fetch(0)).realpath
raise 'Owned cloud archive required' unless archive.to_s.include?('/Library/CloudStorage/OneDrive-IBM/Claude/')
formula = Formulary.factory(archive.to_s, force_bottle: true)
raise 'Local bottle formula required' unless formula.local_bottle_path == archive
raise 'Existing exact keg is never replaced' if formula.prefix.exist?
installer = NativeProofBottleInstaller.new(formula, force_bottle: true, ignore_deps: true,
  skip_post_install: true, skip_link: true, installed_on_request: true, quiet: true)
installer.prelude
raise 'No source fallback' unless installer.pour_bottle?
installer.install
installer.finish
raise 'Homebrew reported failed bottle install' if Homebrew.failed?
