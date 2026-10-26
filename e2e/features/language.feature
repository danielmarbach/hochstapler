Feature: Choosing the language
  Each device chooses its own language. The choice applies to the whole interface and survives a reload.

  Scenario: Choose English on the start page and see the whole game in English
    When Anna opens the start page
    And Anna selects the language "English" on the start page
    Then the start page for Anna shows the text "Who are you?"
    And the language "English" is selected for Anna
    When Anna creates a game in Switzerland with a bot in the selected language
    And Anna starts the game
    Then Anna sees the game board
    Given it is Anna's turn
    And the dice sequence is 2+4
    Then the action bar for Anna shows "Roll"
    When Anna rolls
    Then the log for Anna shows the entry "Anna rolls 2 + 4."

  Scenario: Choose Lozärnerdütsch in the game and keep it after reloading
    Given Anna and Ben play a game in Switzerland
    Then the language "Deutsch" is selected for Anna
    When Anna selects the language "Lozärnerdütsch" in the game
    Then the language "Lozärnerdütsch" is selected for Anna
    And the page of Anna has the document language "gsw"
    When Anna reloads the page
    Then the language "Lozärnerdütsch" is selected for Anna
    And the page of Anna has the document language "gsw"
    And the language "Deutsch" is selected for Ben

  Scenario: Choose French on the start page and see the whole game in French
    When Anna opens the start page
    And Anna selects the language "Français" on the start page
    Then the start page for Anna shows the text "Qui es-tu ?"
    And the language "Français" is selected for Anna
    And the page of Anna has the document language "fr"
    When Anna creates a game in Switzerland with a bot in the selected language
    And Anna starts the game
    Then Anna sees the game board
    Given it is Anna's turn
    And the dice sequence is 2+4
    Then the action bar for Anna shows "Lancer"
    When Anna rolls
    Then the log for Anna shows the entry "Anna lance les dés : 2 + 4."

  Scenario: Choose Italian on the start page and see the whole game in Italian
    When Anna opens the start page
    And Anna selects the language "Italiano" on the start page
    Then the start page for Anna shows the text "Chi sei?"
    And the language "Italiano" is selected for Anna
    And the page of Anna has the document language "it"
    When Anna creates a game in Switzerland with a bot in the selected language
    And Anna starts the game
    Then Anna sees the game board
    Given it is Anna's turn
    And the dice sequence is 2+4
    Then the action bar for Anna shows "Tira"
    When Anna rolls
    Then the log for Anna shows the entry "Anna tira i dadi: 2 + 4."

  Scenario: Switch to Italian in the game and keep it after reloading
    Given Anna and Ben play a game in Switzerland
    When Anna selects the language "Italiano" in the game
    Then the language "Italiano" is selected for Anna
    And the page of Anna has the document language "it"
    When Anna reloads the page
    Then the language "Italiano" is selected for Anna
    And the language "Deutsch" is selected for Ben

  Scenario: Switch to French in the game
    Given Anna and Ben play a game in Switzerland
    When Anna selects the language "Français" in the game
    Then the language "Français" is selected for Anna
    And the page of Anna has the document language "fr"
