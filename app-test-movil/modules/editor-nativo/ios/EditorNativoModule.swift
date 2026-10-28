import ExpoModulesCore

struct TramoRecord: Record {
  @Field var uri: String = ""
  @Field var inicio: Double = 0
  @Field var fin: Double = 0
}

struct TextoRecord: Record {
  @Field var texto: String = ""
  @Field var inicio: Double = 0
  @Field var fin: Double = 0
  @Field var posicion: String = "centro"
  @Field var estilo: String = "titulo"
  @Field var animacion: String = "aparecer"
  @Field var color: String = "#FFFFFF"
}

struct SubtituloRecord: Record {
  @Field var texto: String = ""
  @Field var inicio: Double = 0
  @Field var fin: Double = 0
}

struct MusicaRecord: Record {
  @Field var uri: String = ""
  @Field var volumen: Double = 1
}

struct PedidoRecord: Record {
  @Field var ancho: Int = 1080
  @Field var alto: Int = 1920
  @Field var tramos: [TramoRecord] = []
  @Field var textos: [TextoRecord] = []
  @Field var subtitulos: [SubtituloRecord] = []
  @Field var musica: MusicaRecord? = nil
  @Field var volumenOriginal: Double = 1
}

public class EditorNativoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EditorNativo")
    Events("onProgreso")

    AsyncFunction("exportar") { (pedido: PedidoRecord, promise: Promise) in
      let datos = PedidoVideo(
        ancho: pedido.ancho, alto: pedido.alto,
        tramos: pedido.tramos.map { Tramo(uri: $0.uri, inicio: $0.inicio, fin: $0.fin) },
        textos: pedido.textos.map { TextoVideo(texto: $0.texto, inicio: $0.inicio, fin: $0.fin, posicion: $0.posicion, estilo: $0.estilo, animacion: $0.animacion, color: $0.color) },
        subtitulos: pedido.subtitulos.map { SubtituloVideo(texto: $0.texto, inicio: $0.inicio, fin: $0.fin) },
        musica: pedido.musica.map { MusicaVideo(uri: $0.uri, volumen: $0.volumen) },
        volumenOriginal: pedido.volumenOriginal)
      Task {
        do {
          let url = try await Exportador().exportar(datos) { valor in
            self.sendEvent("onProgreso", ["progreso": valor])
          }
          promise.resolve(url.absoluteString)
        } catch {
          promise.reject("ERR_EXPORTAR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("transcribir") { (uri: String, idioma: String, promise: Promise) in
      Task {
        do {
          let palabras = try await Transcriptor().transcribir(uri: uri, idioma: idioma)
          promise.resolve(palabras.map { ["texto": $0.texto, "inicio": $0.inicio, "fin": $0.fin] as [String: Any] })
        } catch {
          promise.reject("ERR_TRANSCRIBIR", error.localizedDescription)
        }
      }
    }
  }
}
