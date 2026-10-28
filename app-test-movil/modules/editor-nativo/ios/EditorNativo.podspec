Pod::Spec.new do |s|
  s.name           = 'EditorNativo'
  s.version        = '1.0.0'
  s.summary        = 'Exportar video y transcribir voz en el iPhone'
  s.description    = 'Exporta el video final con AVFoundation y transcribe con Speech, en el dispositivo.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
