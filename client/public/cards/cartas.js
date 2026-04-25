// Arquivo central de cartas para Mytragor
// Adicione novas cartas neste array!

const CARD_DEFS = [
  // --- Escolhidos / Líderes ---
  {
    name: 'Valbrak, Heroi do Povo',
    key: 'valbrak',
    kind: 'leader',
    img: '/chosens/layout-valbrak.ai.png',
    filiacao: 'Arcana',
    hp: 30,
    maxHp: 30,
    effectA: 'valbrak',
    effectB: 'valbrak_citizen_boost',
    effect: 'valbrak',
    text: '• Uma vez por turno, quando você convocar um aliado "Cidadão", compre uma carta. • Uma vez por turno, você pode pagar 2 fragmentos ativos e seus aliados "Cidadão" ganham +1 de ataque até o final do turno.'
  },
  {
    name: 'Katsu, o Vingador',
    key: 'katsu',
    kind: 'leader',
    img: '/chosens/layout-katsuvingador.ai.png',
    filiacao: 'Marcial',
    hp: 30,
    maxHp: 30,
    effectA: 'katsu',
    effectB: 'katsu_warrior_burn',
    effect: 'katsu',
    text: '• Aliados "Guerreiro" que você controla podem atacar inimigos que estejam Dispostos. • Uma vez por turno, quando um aliado "Guerreiro" destruir um inimigo em combate, cause 2 de dano no Escolhido inimigo.'
  },
  {
    name: 'Leafae, Guardião da Floresta',
    key: 'leafae',
    kind: 'leader',
    img: '/chosens/layout-leafaefloresta.ai.png',
    filiacao: 'Religioso',
    hp: 30,
    maxHp: 30,
    effectA: 'leafae',
    effectB: 'leafae_vital_guard',
    effect: 'leafae',
    text: '• Sempre que um Aliado que você controla for curado, coloque 1 marcador de "Elo Vital" neste Escolhido. • Uma vez por turno, você pode remover 3 marcadores de "Elo Vital" neste Escolhido, então cure 2 de vida de um Aliado em campo.'
  },
  {
    name: 'Ademais, Aranhas Negras',
    key: 'ademais',
    kind: 'leader',
    img: '/chosens/layout-ademais.ai.png',
    filiacao: 'Sombras',
    hp: 30,
    maxHp: 30,
    effectA: 'ademais_spider_mark',
    effectB: 'ademais_spider_burst',
    effect: 'ademais_spider_mark',
    text: '• Quando um aliado "Aranhas Negras" for convocado, este Escolhido recebe 1 marcador Aranha. • Uma vez por turno, você pode remover 4 marcadores Aranha deste Escolhido. Se o fizer, cause 3 de dano no Escolhido inimigo.'
  },
    // Nota: recebeu stats padrão para ser alvo de ataques/efeitos.
  // Exemplos de outras cartas (adicione todas as cartas reais aqui)
  {
  name: 'Cervo de Galhos Brancos', key: 'cervo_ga_brancos', aliases: ['Cervo dos Galhos Brancos', 'cervo de galhos brancos', 'cervo dos galhos brancos'], kind: 'ally', img: '/allies/layout-cervogalhosbrancos.ai.png', cost: 3, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'curar_animal', effectValue: 1, text: 'Ao ser convocado, cure 1 de Vida de outro aliado "Animal".'
  },
{
  name: 'Cão de Caça Feroz', kind: 'ally', img: '/allies/layout-caocacaferoz.ai.png', cost: 2, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 4, maxHp: 4, damage: 4, atkBonus: 4, keywords: ['investida'], text: 'Investida — Pode atacar no turno que é convocado.'
},
  {
  name: 'Jabuti Barreira', kind: 'ally', img: '/allies/layout-jabutibarreira.ai.png', cost: 4, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 1, hp: 8, maxHp: 8, damage: 1, atkBonus: 1, keywords: ['bloquear'], text: 'Interpor — Este personagem pode bloquear um ataque direcionado a outro personagem.'
  },
  // Carta de teste: Aranhas Negras (aliado de teste)
  {
    name: 'Aranhas Negras, Agiota', kind: 'ally', img: '/allies/layout-agiota.ai.png', cost: 3, classe: 'Ladino', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'agiota', text: 'Uma vez por turno, você pode jogar 1 carta da sua mão, custo 2 ou menos. Em vez de pagar seu custo em fragmentos, cause 2 de dano a este aliado.'
  },
  {
    name: 'Aranhas Negras, Novato', kind: 'ally', img: '/allies/layout-aranhasnovato.ai.png', cost: 1, classe: 'Ladino', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], text: 'Aranhas Negras, Novato'
  },
  {
    name: 'Aranhas Negras, Novato', key: 'token_aranhas', kind: 'ally', img: '/tokens/layout-aranhastoken.ai.png', cost: 1, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 1, hp: 1, maxHp: 1, damage: 1, atkBonus: 1, keywords: [], text: 'Ficha criada por Aranhas Negras, Mascote.'
  },
  {
    name: 'Cidadãos Unidos', key: 'token_povo', kind: 'ally', img: '/tokens/layout-cidadaotoken.ai.png', cost: 0, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Arcana', ac: 1, hp: 1, maxHp: 1, damage: 1, atkBonus: 1, keywords: [], text: 'Ficha de cidadão criada por Ajuda do Povo.'
  },
	{
    name: 'Aranhas Negras, Mascote', kind: 'ally', img: '/allies/layout-aranhasmascote.ai.png', cost: 7, classe: 'Criatura', tipo: 'Animal', filiacao: 'Sombras', ac: 0, hp: 4, maxHp: 4, damage: 2, atkBonus: 2, keywords: [], effect: 'aranhas_mascote', text: 'Quando este aliado for convocado, Crie até 2 Tokens "Aranhas Negras", Criatura, Animal, 1 de vida, 1 de dano e 1 de Resistência.'
  },
  {
    name: 'Gladiador Aposentado', kind: 'ally', img: '/allies/layout-gladiadoraposentado.ai.png', cost: 7, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Neutra', ac: 2, hp: 8, maxHp: 8, damage: 6, atkBonus: 6, keywords: [], text: ''
  },
  {
    name: 'Aranhas Negras, Executor', kind: 'ally', img: '/allies/layout-aranhasexecutor.ai.png', cost: 4, classe: 'Ladino', tipo: 'Humano', filiacao: 'Sombras', ac: 1, hp: 6, maxHp: 6, damage: 3, atkBonus: 3, keywords: [],
    // Ao entrar, permite banir uma carta; também fornece aura de +1 ATK a aliados com "Aranhas Negras" no nome
    effect: 'ban_on_enter', effectValue: 1, auraTarget: { nameIncludes: 'Aranhas Negras' }, auraScope: 'allies', auraProp: 'atk', text: 'Quando este aliado for convocado, você pode deslocar uma carta em campo. Aliados que você controla com "Aranhas Negras" no nome recebem +1 de Ataque.'
  },
  {
    name: 'Goblin Sabotador', kind: 'ally', img: '/allies/layout-goblinsabotador.ai.png', cost: 3, classe: 'Criatura', tipo: 'Humanoide', filiacao: 'Neutra', ac: 1, hp: 4, maxHp: 4, damage: 2, atkBonus: 2, keywords: [], effect: 'destroy_equip_on_enter', text: 'Ao entrar em campo, destrua um equipamento inimigo.'
  },
  {
  name: 'Thorn, o Martelo da Montanha', kind: 'ally', img: '/allies/layout-thornmartelomontanha.ai.png', cost: 6, classe: 'Guerreiro', tipo: 'Anão', filiacao: 'Neutra', ac: 1, hp: 8, maxHp: 8, damage: 6, atkBonus: 6, keywords: ['atropelar'], effect: '', text: 'Atropelar — O excesso de dano em um combate atinge diretamente a vida do Escolhido inimigo.'
  },
 {
  name: 'Urso Negro', key: 'Urso Negro Tanque', kind: 'ally', img: '/allies/layout-ursonegro.ai.png', cost: 5, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 1, hp: 7, maxHp: 7, damage: 4, atkBonus: 4, keywords: [], effect: '', text: ''
 },
  {
    name: 'Bartolomeu, o Inspirador', kind: 'ally', img: '/allies/layout-bartolomeuinspirador.ai.png', cost: 4, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Arcana', ac: 1, hp: 5, maxHp: 5, damage: 2, atkBonus: 2, keywords: [], effect: 'chamar_cidadao', text: 'Quando este aliado for derrotado em combate e enviado do campo para o seu cemitério, você pode convocar um aliado "Cidadão", com nome diferente deste, da sua mão sem pagar o custo dele.', chamarEspecial: { classe: 'Cidadão', origem: ['hand'] }
  },
  {
      name: 'Batedor Kobold', kind: 'ally', img: '/allies/layout-batedorkobold.ai.png', cost: 1, classe: 'Criatura', tipo: 'Humanoide', filiacao: 'Sombras', ac: 0, hp: 2, maxHp: 2, damage: 2, atkBonus: 2, keywords: [], effect: '', text: ''
  },
  {
  name: 'Aprendiz de Magia', kind: 'ally', img: '/allies/layout-aprendizmagia.ai.png', cost: 1, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], text: ''
  },
  {
  name: 'Gladiador Impenetrável', kind: 'ally', img: '/allies/layout-gladiadorimpenetravel.ai.png', cost: 4, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 1, hp: 7, maxHp: 7, damage: 1, atkBonus: 1, keywords: ['bloquear', 'provocar'], text: 'Interpor — Este personagem pode bloquear um ataque direcionado a outro personagem. Desafio — Enquanto este aliado estiver exaurido, seus oponentes só podem atacar aliados com Desafio.'
  },
  {
  name: 'Gladiador Ousado', kind: 'ally', img: '/allies/layout-gladiadorousado.ai.png', cost: 4, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Neutra', ac: 1, hp: 6, maxHp: 6, damage: 3, atkBonus: 3, keywords: ['provocar'], text: 'Desafio — Enquanto este aliado estiver Exaurido, seus oponentes só podem atacar aliados com Desafio.'
  },
  {
name: 'Tamanduá Guardião', kind: 'ally', img: '/allies/layout-tamanduaguardiao.ai.png', cost: 4, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 1, hp: 7, maxHp: 7, damage: 2, atkBonus: 2, keywords: ['provocar'], effect: '', text: 'Desafio — Enquanto este aliado estiver Exaurido, seus oponentes só podem declarar ataques tendo como alvo aliados com Desafio.'
  },
    {
    name: 'Leão Rei Sagrado', kind: 'ally', img: '/allies/layout-leaoreisagrado.ai.png', cost: 6, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 1, hp: 5, maxHp: 5, damage: 4, atkBonus: 4, keywords: [], effect: 'search_deck_animal_aura_atk', effectValue: 1, auraTarget: { tipo: 'Animal' }, auraProp: 'atk', text: 'Quando este aliado for Convocado, adicione um aliado "Animal" do seu baralho para sua mão, em seguida embaralhe seu baralho. Enquanto este aliado estiver em campo, seus aliados "Animal" recebem +1 de ataque.'
    },
  {
  name: 'Aerin Nieloy', kind: 'ally', img: '/allies/layout-aerynnieloy.ai.png', cost: 3, classe: 'Guerreiro', tipo: 'Elfo', filiacao: 'Marcial', ac: 1, hp: 6, maxHp: 6, damage: 2, atkBonus: 2, keywords: ['bloquear'],
    effect: 'aura_hp', effectValue: 1, auraTarget: { classe: 'Cidadão' }, auraScope: 'allies',
    text: 'Interpor — Este personagem pode bloquear um ataque direcionado a outro personagem. Enquanto este aliado estiver em campo, aliados da classe Cidadão recebem +1 de Vida.'
  },

  {
  name: 'Informante do Beco', kind: 'ally', img: '/allies/layout-informantebeco.ai.png', cost: 2, classe: 'Cidadão', tipo: 'Elfo', filiacao: 'Neutra', ac: 1, hp: 3, maxHp: 3, damage: 2, atkBonus: 2, keywords: [], effect: 'informante_beco',text: 'Quando entra no campo, revele para ambos a carta do topo do deck do oponente. Depois, coloque-a de volta no topo.'
  },
  {
    name: 'Gamboa, a Caçadora',
    key: 'gamboa_selva',
    aliases: ['Gamboa, Arqueira da Selva'],
    kind: 'ally',
    img: '/allies/layout-gamboacacadora.ai.png',
    cost: 4,
    classe: 'Ladino',
    tipo: 'Elfo',
    filiacao: 'Neutra',
    ac: 0,
    hp: 4,
    maxHp: 4,
    damage: 3,
    atkBonus: 3,
    keywords: [],
    effect: 'discard_enemy_hand',
    text: 'Quando este aliado for convocado, você pode olhar a mão do seu oponente. Escolha 1 carta na mão dele e descarte.'
  },
  {
  name: 'Miliciano da Vila', kind: 'ally', img: '/allies/layout-milicianovila.ai.png', cost: 2, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 2, maxHp: 2, damage: 2, atkBonus: 2, keywords: [], text: ''
  },
  {
  name: 'Charlatão da Vila', kind: 'ally', img: '/allies/layout-charlataovila.ai.png', cost: 2, classe: 'Cidadão', tipo: 'Elfo', filiacao: 'Arcana', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'charlatao_da_vila', text: 'Quando este Aliado for convocado, compre uma carta, em seguida descarte uma carta da sua mão. O efeito de Charlatão da Vila só pode ser ativado uma vez por turno.'
  },
  {
  name: 'Estudante Arcano', kind: 'ally', img: '/allies/layout-estudantearcano.ai.png', cost: 1, classe: 'Mago', tipo: 'Elfo', filiacao: 'Arcana', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], effect: 'estudante_arcano', text: 'Quando este Aliado for convocado, você pode colocar uma carta da sua mão no fundo do seu baralho. Se fizer isso, compre 1 carta.'
  },
  {
  name: 'Xamã Kobold', kind: 'ally', img: '/allies/layout-xamakobold.ai.png', cost: 2, classe: 'Mago', tipo: 'Humanoide', filiacao: 'Sombras', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], effect: 'xama_kobold', text: 'Quando este Aliado for convocado, você pode Deslocar 1 aliado com "Kobold" no nome, que estiver no seu cemitério. Se o fizer, compre 1 carta.'
  },
{
  name: 'Toupeira Escavadora', kind: 'ally', img: '/allies/layout-toupeiraescavadora.ai.png', cost: 1, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'olhar_topo', text: 'Ao entrar em campo, olhe a carta do topo do seu deck. Você pode mantê-la no topo ou colocá-la no fundo.'
},
  {
    name: 'Porco-espinho Furioso', kind: 'ally', img: '/allies/layout-porcoespinhofurioso.ai.png', cost: 3, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 0, hp: 4, maxHp: 4, damage: 2, atkBonus: 2, keywords: [], effect: 'ally_heal_buff', text: 'Sempre que um personagem que você controla for curado, coloque 1 marcador "Elo Vital" neste aliado. Este aliado +1 de Ataque e +1 de Vida para cada marcador de Elo Vital nele.'
  },
  {
    name: 'Hiena Carniceira', kind: 'ally', img: '/allies/layout-hienacarniceira.ai.png', cost: 3, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 4, maxHp: 4, damage: 3, atkBonus: 3, keywords: [],
    text: 'Quando este aliado for derrotado em combate e enviado para o cemitério, escolha 1 aliado no seu cemitério com custo 3 ou menos e convoque-o para o campo.',
    // Configuração para o mecanismo genérico de "chamar especial" usado por outras cartas
    chamarEspecial: { origem: ['grave'], maxCost: 3 }
  },
  {
    name: 'Arnold, o Escudeiro', kind: 'ally', img: '/allies/layout-Arnoldescudeiro.ai.png',
    cost: 2,
    classe: 'Cidadão', tipo: 'Humano', filiacao: 'Marcial',
    ac: 1, hp: 4, maxHp: 4, damage: 2, atkBonus: 2,
    keywords: [], effect: 'search_deck', query: { kind: 'equip' }, max: 12, shuffleAfter: true,
    text: 'Quando este aliado for convocado, procure no seu baralho um Equipamento e adicione-o à sua mão. Em seguida, embaralhe seu baralho.'
  },
  {
    name: 'O Protetor', kind: 'ally', img: '/allies/layout-oprotetor.ai.png', cost: 3, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Arcana', ac: 0, hp: 4, maxHp: 4, damage: 1, atkBonus: 1, keywords: ['bloquear'], effect: 'aura_hp', effectValue: 1, auraTarget: { classe: 'Cidadão' }, auraScope: 'allies', text: 'Interpor — Este personagem pode bloquear um ataque direcionado a outro personagem. Enquanto este aliado estiver em campo, seus personagens "Cidadão" recebem +1 de Vida.'
  },
  {
    name: 'Gladiador Veloz', kind: 'ally', img: '/allies/layout-gladiadorveloz.ai.png', cost: 3, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 0, hp: 3, maxHp: 3, damage: 4, atkBonus: 4, keywords: ['investida'], text: 'Investida — Pode atacar no turno que é convocado.'
  },

  // Magias, Equipamentos, Ambientes, Truques
  {
  name: 'Mãos Flamejantes', kind: 'spell', img: '/spell/layout-maosflamejantes.ai.png', cost: 2, classe: '', tipo: 'Magia', filiacao: 'Arcana', effect: 'dano_2_inimigo', text: 'Cause 2 de Dano a 1 personagem.'
  },
  {
    name: 'Espionagem Sorrateira', kind: 'spell', img: '/spell/layout-espionagemsorrateira.ai.png', cost: 4, classe: '', tipo: 'Magia', filiacao: 'Sombras', effect: 'espionagem_sorrateira',
    text: 'Olhe a mão do seu oponente. Escolha uma carta Religioso, Marcial ou Arcano dentre elas e descarte-a.'
  },
  {
    name: 'Profanação de Terreno', kind: 'spell', img: '/spell/layout-profanacaoterreno.ai.png', cost: 3, classe: '', tipo: 'Magia', filiacao: 'Neutra', effect: 'destroy_env',
    text: 'Destrua uma carta de Ambiente em campo.'
  },
  {
    name: 'Controle de Correntezas', kind: 'spell', img: '/spell/layout-controlecorrenteza.ai.png', cost: 4, classe: '', tipo: 'Magia', filiacao: 'Religioso', effect: 'destroy_enemy_ally',
    text: 'Destrua um Aliado inimigo em campo.'
  },
  {
    name: 'Ajuda do Povo', kind: 'spell', img: '/spell/layout-ajudapovo.ai.png', cost: 3, classe: '', tipo: 'Magia', filiacao: 'Arcana', effect: 'ajuda_do_povo',
    text: 'Ao ativar esta carta, convoque 2 Tokens "Cidadãos Unidos". Eles são Cidadão, Humano, 1 de Vida, 1 de Ataque e 1 de Resistência.'
  },
    {
      name: 'Contrição',
      kind: 'truque',
      img: '/trick/layout-constricaoll.ai.png',
      cost: 4,
      classe: '',
      tipo: 'Truque',
      filiacao: 'Religioso',
      effect: 'freeser',
      text: 'Quando um oponente declarar um ataque: Negue esse ataque. O personagem atacante permanece exaurido até o fim do próximo turno do oponente.'
    },
    {
      name: 'Aranhas Negras, Emboscada',
      kind: 'truque',
      img: '/trick/layout-aranhasemboscada.ai.png',
      cost: 3,
      classe: '',
      tipo: 'Truque',
      filiacao: 'Sombras',
      effect: 'aranhas_emboscada',
      text: 'Quando um oponente declarar um ataque: o personagem atacante perde 1 de Ataque até o final daquele embate. Se você controlar um aliado com "Aranhas Negras" no nome, compre 1 carta.'
    },
  {
    name: 'Interrupção Perfeita', kind: 'truque', img: '/trick/layout-interrupcaoperfeita.ai.png', cost: 2, classe: '', tipo: 'Truque', filiacao: 'Arcana', effect: 'anular_magia_truque', text: 'Quando o oponente ativa uma magia ou truque, anule o efeito.'
  },
    {
      name: 'Alerta de Fuga',
      kind: 'truque',
      img: '/spell/layout-alertafuga.ai.png',
      cost: 2,
      classe: '',
      tipo: 'Truque',
      filiacao: 'Marcial',
      effect: 'bem_treinado',
      text: 'Quando um aliado do seu lado do campo for enviado ao cemitério: Escolha 1 aliado "Marcial" bo seu cemitério e convoque-o para o campo.'
    },
  {
    name: 'Tempestade Arcana', kind: 'env', img: '/envs/layout-tempestadearcana.ai.png', cost: 3, classe: '', tipo: 'Ambiente', filiacao: 'Arcana', effect: 'arcana_draw', text: 'Enquanto esta carta estiver em campo, jogadores com Escolhido "Arcano" compram 1 carta adicional na Fase Inicial.'
  },
  {
    name: 'Caminhos Perigosos', kind: 'env', img: '/envs/layout-caminhosperigosos.ai.png', cost: 3, classe: '', tipo: 'Ambiente', filiacao: 'Sombras', effect: 'sombra_penalty', text: 'Enquanto esta carta estiver em campo, Jogadores cujo Escolhido não seja "Sombras", têm 1 fragmento ativo a menos.'
  },
  {
    name: 'Campos Ensanguentados', kind: 'env', img: '/envs/layout-camposensanguentados.ai.png', cost: 4, classe: '', tipo: 'Ambiente', filiacao: 'Marcial', effect: 'marcial_bonus', text: 'Enquanto esta carta estiver em campo, jogadores cujo Escolhido seja Marcial concedem +1 de Ataque aos seus personagens Marcial.'
  },
  {
    name: 'Catedral Ensolarada', kind: 'env', img: '/envs/layout-catedralensolarada.ai.png', cost: 3, classe: '', tipo: 'Ambiente', filiacao: 'Religioso', effect: 'religioso_protecao', text: 'Enquanto esta carta estiver em campo, jogadores com Escolhido "Religioso" escolhem 1 Aliado em sua fase inicial. O Aliado selecionado recebe +2 de vida até o inicio do próximo turno do jogador. Se ao perder o bônus concedido por este Ambiente o Aliado chegar a 0 ou menos de vida, ele é enviado para o cemitério.'
  },
  {
    name: 'Lâmina Serralhada', kind: 'equip', img: '/equip/layout-laminaserrilhada.ai.png', cost: 1, classe: '', tipo: 'Equipamento', filiacao: 'Marcial', effect: 'dmg_bonus', dmgBonus: 2, text: 'O personagem equipado ganha +2 de dano.'
  },
  {
  name: 'Manto de Couro', kind: 'equip', img: '/equip/layout-mantocouro.ai.png', cost: 1, classe: '', tipo: 'Equipamento', filiacao: 'Neutra', acBonus: 1, hpBonus: 1, text: 'O personagem equipado recebe +1 de Resistência e +1 de Vida.'
  },
  {
    name: 'Orbe de Absorção',
    kind: 'equip',
    img: '/equip/layout-orbeabsorcao.ai.png',
    cost: 2,
    classe: '',
    tipo: 'Equipamento',
    filiacao: 'Arcana',
    effect: 'draw_bonus',
    effectValue: 1,
    atkBonus: 0,
    text: 'Quando este equipamento entrar em campo, você pode deslocar qualquer quantidade de cartas de Magia do seu cemitério. O personagem equipado recebe +1 de Ataque para cada carta deslocada desta forma.'
  },
  {
    name: 'Redoma Santa', kind: 'equip', img: '/equip/layout-redomasanta.ai.png', cost: 5, classe: '', tipo: 'Equipamento', filiacao: 'Religioso', acBonus: 1, effect: 'redoma_santa', text: 'O personagem equipado recebe +1 de Resistência. Quando este equipamento entrar em campo, cure 3 de vida de um Aliado em campo.'
  },
  {
    name: 'Aranhas Negras, Quelíceras',
    kind: 'equip',
    img: '/equip/layout-aranhasqueliceras.ai.png',
    cost: 3,
    classe: '',
    tipo: 'Equipamento',
    filiacao: 'Sombras',
    effect: 'on_grave_damage_leader',
    effectValue: 2,
    atkBonus: 1,
    text: 'O personagem equipado ganha +1 de Ataque. Quando esta carta for enviada do campo para o cemitério, cause 2 de Dano ao Escolhido inimigo.'
  },
  {
    name: 'Tônico Revigorante', kind: 'spell', img: '/spell/layout-tonicorevigorante.ai.png', cost: 2, classe: '', tipo: 'Magia', filiacao: 'Arcana',
    escolha1: true, effectA: { type: 'heal', value: 3 }, effectB: { type: 'draw', value: 1 }, text: 'Escolha 1: • Escolha um personagem, cure 3 de Vida dele. • Compre 1 carta.'
  },
   {
    name: 'Bem Treinado', kind: 'spell', img: '/spell/layout-bemtreinado.ai.png', 
    cost: 5,
    classe: '', tipo: 'Magia', filiacao: 'Marcial', escolha1: true,
    effectA: { type: 'exhaust_martial_to_displace_ally' }, effectB: { type: 'search_deck', query: {kind: 'spell', filiacao: 'Marcial'}, max:12, shuffleAfter: true }, text: 'Escolha 1: • Exaura um aliado "Marcial" que você controla: desloque 1 aliado inimigo. • Adicione à sua 1 carta de magia "Marcial" do seu baralho. Em seguida embaralhe seu baralho.'
  },
  {
  name: 'Fruto Abençoado', kind: 'spell', img: '/spell/layout-frutoabencoado.ai.png', cost: 0, classe: '', tipo: 'Magia', filiacao: 'Neutra', escolha1: true, resolveZone: 'banished',
    effectA: { type: 'heal', value: 1 },
    effectB: { type: 'fragment_back', value: 1 },
    text: 'Escolha 1: • Cure 1 de Vida de um personagem. • Recupere 1 fragmento. Desloque esta carta após resolver.'
  },
  {
    name: 'Invasão de Cativeiro', kind: 'spell', img: '/spell/layout-invasaocativeiro.ai.png', cost: 3, classe: '', tipo: 'Magia', filiacao: 'Neutra', escolha1: true,
    effectA: { type: 'tap_enemy_ally' },
    effectB: { type: 'atk_temp', value: 1 },
    text: 'Escolha 1: • Exaure um aliado inimigo. • Escolha 1 aliado em campo: ele recebe +1 de Ataque até o fim do turno.'
  },
  {
    name: 'Quebra-Aço', kind: 'spell', img: '/spell/layout-quebraaco.ai.png', cost: 1, classe: '', tipo: 'Magia', filiacao: 'Neutra', effect: 'destroy_equip', text: 'Destrua um equipamento em campo.'
  },
  {
    name: 'Sede de Vingança', kind: 'spell', img: '/spell/layout-sedevinganca.ai.png', cost: 5, classe: '', tipo: 'Magia', filiacao: 'Marcial', effect: 'sede_vinganca', effectValue: 3, text: 'Escolha um Guerreiro aliado: +3 de Ataque até o fim do turno. Se ele derrotar um inimigo neste turno, compre 1 carta e deixe-o disposto. Esta magia não pode ser ativada novamente neste turno.'
  },
  {
    name: 'Gladiador Implacável', kind: 'ally', img: '/allies/layout-gladiadorimplacavel.ai.png', cost: 4, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 1, hp: 5, maxHp: 5, damage: 3, atkBonus: 3, keywords: [], effect: 'buff_on_kill', effectValue: { atk: 1, ac: 1 }, text: 'Quando este Aliado vencer um inimigo em combate e enviá-lo para o cemitério, coloque 1 marcador "Sangue" neste aliado. Ele recebe +1 de Ataque e +1 de Resistência para cada marcador Sangue nele.'
  },
  {
  name: 'Yohan, Ronin Vigilante', aliases: ['Yoran, Ronin Vigilante'], kind: 'ally', img: '/allies/layout-yohanronin.ai.png', cost: 2, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 0, hp: 3, maxHp: 3, damage: 2, atkBonus: 2, keywords: [], effect: 'kornex_buff_per_marcial_in_play', effectValue: 1, text: 'Este aliado recebe +1 de Ataque para cada outra carta "Marcial" no campo de qualquer jogador.'
  },
  {
    name: 'Livro Arcano Instável', kind: 'equip', img: '/equip/layout-livroinstavel.ai.png', cost: 2, classe: '', tipo: 'Equipamento', filiacao: 'Arcana', effect: 'olhar_topo', atkBonus: 1, text: 'O aliado equipado recebe +1 de Ataque. Quando esta carta entrar em campo, olhe a carta do topo do seu deck. Você pode mantê-la no topo ou colocá-la no fundo do deck.'
  },
  // Exemplo: carta que exige pagar vida de um aliado em vez de fragmentos
  {
    name: 'Aranhas Negras, Milícia', kind: 'spell', img: '/spell/layout-aranhasmilicia.ai.png', cost: 1, classe: '', tipo: 'Magia', filiacao: 'Sombras', effect: 'blood_sacrifice', costHp: 2, text: 'Cause 2 de dano a um personagem que você controla. Depois cause 4 de dano a um personagem inimigo.'
  },
   // Adicione todas as cartas reais aqui!
  {
    name: 'Pica-pau Agulheiro', kind: 'ally', img: '/allies/layout-picapauagulheiro.ai.png', cost: 2, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 3, maxHp: 3, damage: 2, atkBonus: 2, keywords: [],
    effect: 'damage_ally_on_enter', effectValue: 1, text: 'Quando este aliado for convocado, você pode causar 1 de dano a outro aliado que você controla. Se o fizer, compre 1 carta.'
  },
  
  // --- Cartas de exemplo para testar search_deck ---
 {
    name: 'Bom Fruto', kind: 'spell', img: '/spell/layout-bomfruto.ai.png', cost: 2, classe: '', tipo: 'Magia', filiacao: 'Religioso',
    effect: 'search_deck', query: { name: 'Fruto Abençoado' }, max: 12, title: 'Buscar Fruto Abençoado', shuffleAfter: true, text: 'Procure em seu baralho por 1 carta "Fruto Abençoado", revele-a e coloque-a em sua mão. Depois, embaralhe seu baralho.'
  },
  {
    name: 'Aranhas Negras, Observadora', kind: 'ally', img: '/allies/layout-aranhasobservadora.ai.png', cost: 1, classe: 'Cidadão', tipo: 'Elfo', filiacao: 'Sombras',
    ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1,
    effect: 'aranhas_observadora', query: { name: 'Aranhas Negras' }, max: 15, shuffleAfter: true, text: 'Quando este aliado for convocado, procure no seu baralho uma carta com "Aranhas Negras" no nome e adicione-a à sua mão. Em seguida, embaralhe seu baralho. Você só pode ativar o efeito de "Aranhas Negras, Observadora" uma vez por turno.'
  },
  {
    name: 'Troca de Energia', kind: 'spell', img: '/spell/layout-trocaenergia.ai.png', cost: 4, classe: '', tipo: 'Magia', filiacao: 'Religioso',
    effect: 'amizade_floresta', effectValue: { damageToAnimal: 2, healValue: 4 }, text: 'Escolha um Aliado "Animal" que você controla. Cause 2 de Dano. Em seguida, cure 4 de Vida do seu Escolhido.'
  },
  // Cartão de teste para self_discard -> força o inimigo a descartar 1 carta aleatória
  {
    name: 'Aranhas Negras, Informante',
    kind: 'ally',
    img: '/allies/layout-aranhasinformante.ai.png',
    cost: 5,
    classe: 'Guerreiro',
    tipo: 'Humano',
    filiacao: 'Sombras',
    ac: 1,
    hp: 5,
    maxHp: 5,
    damage: 3,
    atkBonus: 3,
    keywords: [],
    effect: 'aranhas_informante',
    effectValue: { damage: 4, discard: 1 },
    text: 'Quando este aliado for convocado, cause 4 de dano ao seu Escolhido. Depois, seu oponente descarta 1 carta aleatória da própria mão.'
  },
];

if (typeof window !== 'undefined') {
  window.CARD_DEFS = CARD_DEFS;
  // Validador simples
  CARD_DEFS.forEach((card, idx) => {
    let missing = [];
    if (!('name' in card)) missing.push('name');
    if (!('kind' in card)) missing.push('kind');
    if (!('img' in card)) missing.push('img');
    if (!('classe' in card)) missing.push('classe');
    if (!('tipo' in card)) missing.push('tipo');
    if (!('filiacao' in card)) missing.push('filiacao');
    if (missing.length) {
      console.warn(`Carta ${idx} (${card.name||'sem nome'}): campos faltando:`, missing);
    }
  });
}
// Removido export para compatibilidade com <script> HTML

// Lista de efeitos customizados:
// - curar_animal: Ao entrar em campo, cura 1 de vida de um aliado do tipo Animal.
// - aura_hp: Aura que aumenta a vida máxima de aliados da Classe Cidadão.
// - buff_on_kill: Ao derrotar um inimigo, ganha bônus permanente.
// - olhar_topo: Revela a carta do topo do deck ao entrar em campo.
// - kornex_buff_per_marcial_in_play: Kornex Ronin ganha +1 ATK para cada outra carta Marcial em campo.
// - costHp: novo campo opcional que indica que o custo da carta deve ser pago com HP de um aliado (ex.: costHp: 2). O motor exibirá uma escolha de aliado/líder para pagar a vida antes de resolver a carta. Após o pagamento, a carta continua a ser resolvida normalmente (útil para efeitos como 'blood_sacrifice').
// Adicione novos efeitos aqui para referência e documentação.
