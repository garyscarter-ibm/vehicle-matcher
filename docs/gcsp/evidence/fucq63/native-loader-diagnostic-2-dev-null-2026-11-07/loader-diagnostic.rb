# Invoked by `brew ruby`: brew.sh has already removed internal shell variables.
raise 'One exact owned specification required' unless ARGV.length == 1
raise 'Internal opt-out unexpectedly survived brew startup' if ENV.key?('HOMEBREW_INTERNAL_ALLOW_PACKAGES_FROM_PATHS')
raise 'Developer/API overrides forbidden' if ENV.key?('HOMEBREW_DEVELOPER') || ENV.key?('HOMEBREW_NO_INSTALL_FROM_API')
ENV['HOMEBREW_INTERNAL_ALLOW_PACKAGES_FROM_PATHS'] = '1'
require 'formulary'
require 'json'
require 'digest'
spec = JSON.parse(File.read(ARGV.fetch(0)))
raise 'Exactly seven retained bottles required' unless spec.length == 7
raise 'Local-path guard still enabled' if Homebrew::EnvConfig.forbid_packages_from_paths?
puts JSON.generate(event: 'ruby-startup', flagAssignedAfterStartup: true, guard: false,
                   developerSet: false, noInstallFromApiSet: false)
spec.each do |item|
  archive = Pathname(item.fetch('archive')).realpath
  raise 'Owned cloud archive required' unless archive.to_s.start_with?(ENV.fetch('TMPDIR') + '/')
  regex_match = HOMEBREW_BOTTLES_EXTNAME_REGEX.match?(archive.to_s)
  file_exists = File.file?(archive)
  raise 'Archive identity mismatch' unless file_exists && regex_match &&
    File.size(archive) == item.fetch('bytes') && Digest::SHA256.file(archive).hexdigest == item.fetch('sha256')
  loader = Formulary::FromBottleLoader.try_new(archive.to_s)
  raise 'Exact bottle loader required' unless loader.instance_of?(Formulary::FromBottleLoader)
  contents = Utils::Bottles.formula_contents(archive, name: item.fetch('name'))
  raise 'Reviewed embedded Ruby mismatch' unless Digest::SHA256.hexdigest(contents) == item.fetch('embeddedRubySha256')
  formula = loader.get_formula(:stable, force_bottle: true)
  raise 'Formula identity mismatch' unless formula.name == item.fetch('name') &&
    formula.pkg_version.to_s == item.fetch('pkgVersion') && formula.local_bottle_path == archive
  # Check the original driver's factory route too; it must select this same local bottle.
  factory_formula = Formulary.factory(archive.to_s, force_bottle: true)
  raise 'Factory identity mismatch' unless factory_formula.name == formula.name &&
    factory_formula.pkg_version == formula.pkg_version && factory_formula.local_bottle_path == archive
  puts JSON.generate(event: 'bottle-loader', name: formula.name, pkgVersion: formula.pkg_version.to_s,
                     guard: Homebrew::EnvConfig.forbid_packages_from_paths?, regexMatch: regex_match,
                     fileExists: file_exists, loaderClass: loader.class.name,
                     localBottlePath: formula.local_bottle_path.to_s, factoryExact: true,
                     embeddedRubySha256: Digest::SHA256.hexdigest(contents))
end
raise 'FormulaInstaller unexpectedly loaded' if Object.const_defined?(:FormulaInstaller, false)
puts JSON.generate(event: 'complete', count: spec.length, formulaInstallerLoaded: false,
                   installationAttempted: false, publicRequests: 0, acceptance: false)
